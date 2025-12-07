import {
  Command,
  filterEndpoints,
  l3EndpointToL4,
  l3EndpointToString,
  l4EndpointToString,
  parseL3Endpoint,
} from "@highstate/common"
import { text } from "@highstate/contract"
import { createK8sTerminal } from "@highstate/k8s"
import { type common, k3s } from "@highstate/library"
import {
  fileFromString,
  forUnit,
  type InputRecord,
  interpolate,
  output,
  type Resource,
  secret,
  toPromise,
} from "@highstate/pulumi"
import { KubeConfig } from "@kubernetes/client-node"
import { core, Provider } from "@pulumi/kubernetes"
import { isIncludedIn, uniqueBy } from "remeda"

const { name, args, inputs, outputs } = forUnit(k3s.cluster)

const { masters, workers } = await toPromise(inputs)

const seed = masters[0]

const endpoints = uniqueBy(
  [...workers, ...masters].flatMap(server =>
    server.endpoints.map(endpoint => parseL3Endpoint(endpoint)),
  ),
  l3EndpointToString,
)

const apiEndpoints = uniqueBy(
  masters.flatMap(server => server.endpoints.map(endpoint => l3EndpointToL4(endpoint, 6443))),
  l4EndpointToString,
)

const sharedConfig: Record<string, unknown> = {
  ...args.config,
}

const serverConfig: Record<string, unknown> = {
  ...sharedConfig,
  ...args.serverConfig,
  "tls-san": apiEndpoints.map(l3EndpointToString),
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

const serverConfigContent = JSON.stringify(serverConfig, null, 2)
const agentConfigContent = JSON.stringify(agentConfig, null, 2)

const seedInstallCommand = createNode(seed, "server", { K3S_CLUSTER_INIT: "true" })

const tokenCommand = Command.receiveTextFile(
  "token",
  {
    host: seed,
    path: "/var/lib/rancher/k3s/server/node-token",
  },
  { dependsOn: seedInstallCommand },
)

const agentTokenCommand = Command.receiveTextFile(
  "agent-token",
  {
    host: seed,
    path: "/var/lib/rancher/k3s/server/agent-token",
  },
  { dependsOn: seedInstallCommand },
)

for (const master of masters.slice(1)) {
  createNode(master, "server", {
    K3S_TOKEN: tokenCommand.stdout,
    K3S_URL: `https://${l4EndpointToString(apiEndpoints[0])}`,
  })
}

for (const worker of workers) {
  createNode(worker, "agent", {
    K3S_TOKEN: agentTokenCommand.stdout,
    K3S_URL: `https://${l4EndpointToString(apiEndpoints[0])}`,
  })
}

function createNode(
  server: common.Server,
  type: "server" | "agent",
  env: InputRecord<string>,
  dependsOn?: Resource,
) {
  const configFileCommand = Command.createTextFile(`config-${server.hostname}`, {
    host: server,
    path: "/etc/rancher/k3s/config.yaml",
    content: type === "server" ? serverConfigContent : agentConfigContent,
  })

  const registryConfigFileCommand = Command.createTextFile(`registry-config-${server.hostname}`, {
    host: server,
    path: "/etc/rancher/k3s/registries.yaml",
    content: JSON.stringify(args.registries ?? {}, null, 2),
  })

  const envString = output(env).apply(env => {
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")
  })

  return new Command(
    `install-${server.hostname}`,
    {
      host: server,
      create: interpolate`curl -fL https://raw.githubusercontent.com/k3s-io/k3s/refs/heads/main/install.sh | ${envString} sh -s - ${type}`,
      delete: "/usr/local/bin/k3s-uninstall.sh || true",
    },
    {
      dependsOn: [configFileCommand, registryConfigFileCommand, ...(dependsOn ? [dependsOn] : [])],
    },
  )
}

const kubeconfigResult = Command.receiveTextFile(
  "kubeconfig",
  {
    host: seed,
    path: "/etc/rancher/k3s/k3s.yaml",
  },
  { dependsOn: seedInstallCommand },
)

const kubeconfig = await toPromise(
  kubeconfigResult.stdout.apply(kubeconfig =>
    kubeconfig.replace("127.0.0.1:6443", l4EndpointToString(apiEndpoints[0])),
  ),
)

const kubeConfig = new KubeConfig()
kubeConfig.loadFromString(kubeconfig)

const provider = new Provider(name, { kubeconfig: secret(kubeconfig) })
const kubeSystem = core.v1.Namespace.get("kube-system", "kube-system", { provider })

// const kubeconfigFile = fileFromString("config", kubeconfig, "text/yaml", true)

export default outputs({
  k8sCluster: {
    id: kubeSystem.metadata.uid,
    connectionId: kubeSystem.metadata.uid,
    name,

    externalIps: filterEndpoints(endpoints, ["public", "external"])
      .filter(endpoint => endpoint.type !== "hostname")
      .map(l3EndpointToString),

    endpoints,
    apiEndpoints,

    quirks: {
      externalServiceType: args.disabledComponents.includes("servicelb")
        ? "NodePort"
        : "LoadBalancer",
    },

    kubeconfig: secret(kubeconfig),
  },

  endpoints,
  apiEndpoints,

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
          file: fileFromString("kubeconfig", kubeconfig, {
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
