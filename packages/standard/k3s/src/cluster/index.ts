import { Command, l3EndpointToL4, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { text } from "@highstate/contract"
import { createK8sTerminal } from "@highstate/k8s"
import { common, k3s, k8s } from "@highstate/library"
import {
  forUnit,
  interpolate,
  makeEntityOutput,
  makeFileOutput,
  makeSecretOutput,
  secret,
  toPromise,
} from "@highstate/pulumi"
import { KubeConfig } from "@kubernetes/client-node"
import { core, Provider } from "@pulumi/kubernetes"
import { isIncludedIn, uniqueBy } from "remeda"
import { createK3sNode, createK3sWorker } from "../shared"

const { name, args, inputs, outputs } = forUnit(k3s.cluster)

const { masters, publicEndpoint: inputPublicEndpoint, workers } = await toPromise(inputs)

const seed = masters[0]

const endpoints = uniqueBy(
  [...workers, ...masters].flatMap(server => server.endpoints),
  l3EndpointToString,
)

const masterBootstrapEndpoint = l3EndpointToL4(seed.endpoints[0], 6443)
const apiEndpoints = uniqueBy(
  [
    ...(inputPublicEndpoint ? [inputPublicEndpoint] : []),
    ...masters.flatMap(server => server.endpoints.map(endpoint => l3EndpointToL4(endpoint, 6443))),
  ],
  l4EndpointToString,
)
const publicEndpoint = apiEndpoints[0]

if (!publicEndpoint) {
  throw new Error(`Could not determine K3s public endpoint`)
}

const tlsSans = Array.from(new Set(apiEndpoints.map(l3EndpointToString)))

const sharedConfig: Record<string, unknown> = {
  ...args.config,
}

const serverConfig: Record<string, unknown> = {
  ...sharedConfig,
  ...args.serverConfig,
  "tls-san": tlsSans,
  disable: args.disabledComponents.filter(isIncludedIn(k3s.packagedComponents)),
}

const agentConfig: Record<string, unknown> = {
  ...sharedConfig,
  ...args.agentConfig,
}

for (const disabledComponent of args.disabledComponents) {
  if (isIncludedIn(disabledComponent, k3s.internalComponents)) {
    serverConfig[`disable-${disabledComponent}`] = true
  }
}

if (args.cni === "none") {
  serverConfig["flannel-backend"] = "none"
}

const seedInstallCommand = createK3sNode({
  server: seed,
  type: "server",
  env: { K3S_CLUSTER_INIT: "true" },
  config: serverConfig,
  registries: args.registries ?? {},
  nodeConfig: args.nodeConfig,
})
let previousMasterReadyCommand = createServerReadyCommand(seed, seedInstallCommand)
const masterReadyCommands = [previousMasterReadyCommand]

const tokenCommand = Command.receiveTextFile(
  "token",
  {
    host: seed,
    path: "/var/lib/rancher/k3s/server/node-token",
  },
  { dependsOn: previousMasterReadyCommand },
)

const agentTokenCommand = Command.receiveTextFile(
  "agent-token",
  {
    host: seed,
    path: "/var/lib/rancher/k3s/server/agent-token",
  },
  { dependsOn: previousMasterReadyCommand },
)

for (const master of masters.slice(1)) {
  const installCommand = createK3sNode({
    server: master,
    type: "server",
    env: {
      K3S_TOKEN: tokenCommand.stdout,
      K3S_URL: `https://${l4EndpointToString(masterBootstrapEndpoint)}`,
    },
    config: serverConfig,
    registries: args.registries ?? {},
    nodeConfig: args.nodeConfig,
    dependsOn: [previousMasterReadyCommand],
  })

  previousMasterReadyCommand = createServerReadyCommand(master, installCommand)
  masterReadyCommands.push(previousMasterReadyCommand)
}

const k3sCluster = makeEntityOutput({
  entity: k3s.clusterEntity,
  identity: name,
  meta: {
    title: name,
  },
  value: {
    name,
    bootstrapEndpoint: publicEndpoint,
    agentToken: makeSecretOutput(agentTokenCommand.stdout),
    agentConfig,
    registries: args.registries ?? {},
  },
})

for (const worker of workers) {
  createK3sWorker({
    server: worker,
    bootstrapEndpoint: publicEndpoint,
    agentToken: agentTokenCommand.stdout,
    agentConfig,
    registries: args.registries ?? {},
    nodeConfig: args.nodeConfig,
    dependsOn: masterReadyCommands,
  })
}

function createServerReadyCommand(server: common.Server, installCommand: Command) {
  return new Command(
    `ready-${server.hostname}`,
    {
      host: server,
      create: "while ! k3s kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 5; done",
      ignoreCommandChanges: false,
    },
    { dependsOn: installCommand },
  )
}

const kubeconfigResult = Command.receiveTextFile(
  "kubeconfig",
  {
    host: seed,
    path: "/etc/rancher/k3s/k3s.yaml",
  },
  { dependsOn: masterReadyCommands },
)

const kubeconfig = await toPromise(
  kubeconfigResult.stdout.apply(kubeconfig =>
    kubeconfig.replace("127.0.0.1:6443", l4EndpointToString(publicEndpoint)),
  ),
)

const kubeConfig = new KubeConfig()
kubeConfig.loadFromString(kubeconfig)

const provider = new Provider(name, { kubeconfig: secret(kubeconfig) })
const kubeSystem = core.v1.Namespace.get("kube-system", "kube-system", { provider })

const k8sCluster = makeEntityOutput({
  entity: k8s.clusterEntity,
  identity: kubeSystem.metadata.uid,
  meta: {
    title: name,
  },
  value: {
    id: kubeSystem.metadata.uid,
    connectionId: kubeSystem.metadata.uid,
    name,

    externalIps: endpoints
      .filter(endpoint => endpoint.type !== "hostname")
      .map(endpoint => endpoint.address),

    endpoints,
    apiEndpoints,

    quirks: {
      externalServiceType: args.disabledComponents.includes("servicelb")
        ? "NodePort"
        : "LoadBalancer",
    },

    kubeconfig: makeEntityOutput({
      entity: common.fileEntity,
      identity: interpolate`${kubeSystem.metadata.uid}:kubeconfig`,
      meta: {
        title: "kubeconfig",
      },
      value: {
        meta: {
          name: "kubeconfig",
          mode: 0o600,
          contentType: "text/yaml",
        },
        content: {
          type: "embedded-secret",
          value: kubeconfig,
        },
      },
    }),
  },
})

export default outputs({
  k8sCluster,
  cluster: k3sCluster,

  $terminals: [createK8sTerminal(kubeconfig)],

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },

  $pages: {
    index: {
      meta: {
        title: "K3s Cluster",
      },
      content: [
        {
          type: "markdown",
          content: text`
            The cluster is up and running.

            You can access the cluster via the terminal or by using the kubeconfig file.
          `,
        },
        {
          type: "file",
          file: makeFileOutput({
            name: "kubeconfig",
            content: kubeconfig,
            contentType: "text/yaml",
            isSecret: true,
          }),
        },
        {
          type: "markdown",
          content: secret(text`
            You can also copy the following content of the kubeconfig file and use it to access the cluster:

            \`\`\`yaml
            ${kubeconfig}
            \`\`\`
          `),
        },
      ],
    },
  },
})
