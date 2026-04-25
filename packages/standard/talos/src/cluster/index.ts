import { readFile } from "node:fs/promises"
import { l3EndpointToL4, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { text } from "@highstate/contract"
import { RenderedChart } from "@highstate/k8s"
import { common, k8s, talos } from "@highstate/library"
import {
  all,
  forUnit,
  type Input,
  makeEntityOutput,
  makeFileOutput,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { KubeConfig } from "@kubernetes/client-node"
import { core, Provider } from "@pulumi/kubernetes"
import { cluster, machine } from "@pulumiverse/talos"
import { uniqueBy } from "remeda"

const {
  name,
  args,
  inputs: { masters, workers },
  outputs,
} = forUnit(talos.cluster)

if (!masters.length) {
  throw new Error("At least one master node is required.")
}

const cni = args.cni ?? "cilium"
const csi = args.csi ?? "local-path-provisioner"

interface InlineManifest {
  name: string
  contents: Input<string>
}

interface ExtraMount {
  destination: string
  type: string
  source: string
  options: string[]
}

const inlineManifests: InlineManifest[] = []
const extraMounts: ExtraMount[] = []

if (cni === "cilium") {
  const { chart } = await import("@highstate/cilium")

  const cilium = new RenderedChart("cilium", {
    namespace: "kube-system",
    chart,

    values: {
      "ipam.mode": "kubernetes",
      // "kubeProxyReplacement": "true",
      kubeProxyReplacement: "false",
      "operator.replicas": "1",
      "hubble.relay.enabled": "true",
      "hubble.ui.enabled": "true",
      "securityContext.capabilities.ciliumAgent":
        "{CHOWN,KILL,NET_ADMIN,NET_RAW,IPC_LOCK,SYS_ADMIN,SYS_RESOURCE,DAC_OVERRIDE,FOWNER,SETGID,SETUID}",
      "securityContext.capabilities.cleanCiliumState": "{NET_ADMIN,SYS_ADMIN,SYS_RESOURCE}",
      "cgroup.autoMount.enabled": "false",
      "cgroup.hostRoot": "/sys/fs/cgroup",
      // "k8sServiceHost": "localhost",
      // "k8sServicePort": "7445",
      // "bpf.lbExternalClusterIP": "true",
      "dnsProxy.dnsRejectResponseCode": "nameError",
    },
  })

  inlineManifests.push({
    name: "cilium",
    contents: cilium.manifest,
  })
}

if (csi === "local-path-provisioner") {
  extraMounts.push({
    destination: "/var/lib/local-path-provisioner",
    type: "bind",
    source: "/var/lib/local-path-provisioner",
    options: ["bind", "rshared", "rw"],
  })

  inlineManifests.push({
    name: "local-path-provisioner",
    contents: await readFile("../../assets/local-path-provisioner.yaml", "utf-8"),
  })
}

if (args.enableTunDevicePlugin) {
  inlineManifests.push({
    name: "tun-device-plugin",
    contents: await readFile("../../assets/tun-device-plugin.yaml", "utf-8"),
  })
}

const clusterName = args.clusterName ?? name

const globalConfigPatch = output({
  machine: {
    install: {
      image:
        "factory.talos.dev/nocloud-installer/ce4c980550dd2ab1b17bbf2b08801c7eb59418eafe8f279833297925d67c7515:v1.11.5",
      disk: "/dev/vda",
    },
    kubelet: {
      extraMounts,
    },
  },
  cluster: {
    allowSchedulingOnMasters:
      args.scheduleOnMastersPolicy === "when-no-workers"
        ? workers.length === 0
        : args.scheduleOnMastersPolicy === "always",
    inlineManifests,
    network: cni !== "flannel" ? { cni: { name: "none" } } : undefined,
    // proxy: cni === "cilium" ? { disabled: true } : undefined,
  },
}).apply(JSON.stringify)

const secrets = new machine.Secrets("secrets", { talosVersion: "v1.11.5" })

const apiEndpoint = `https://${l3EndpointToString(masters[0].endpoints[0])}:6443`

const masterConfig = getConfiguration("controlplane")
const workerConfig = getConfiguration("worker")

const masterApplies = masters.map(master => {
  return new machine.ConfigurationApply(
    master.hostname,
    getConfigurationApplyArgs(master, masterConfig.machineConfiguration),
  )
})

const masterNodes = masterApplies.map(masterApply => masterApply.node)

const bootstrap = new machine.Bootstrap(
  "bootstrap",
  {
    clientConfiguration: secrets.clientConfiguration,
    node: masterApplies[0]!.node,
  },
  { dependsOn: masterApplies },
)

const workerApplies = workers.map(worker => {
  return new machine.ConfigurationApply(
    worker.hostname,
    getConfigurationApplyArgs(worker, workerConfig.machineConfiguration),
    { dependsOn: bootstrap },
  )
})

const workerNodes = workerApplies.map(workerApply => workerApply.node)

// Check the health of the cluster and export the kubeconfig
const kubeconfig = all([
  cluster.getKubeconfigOutput({
    clientConfiguration: secrets.clientConfiguration,
    node: masterApplies[0]!.node,
  }),
  cluster.getHealthOutput({
    clientConfiguration: secrets.clientConfiguration,
    endpoints: masterNodes,
    controlPlaneNodes: masterNodes,
    workerNodes,
  }),
]).apply(([kubeconfig]) => kubeconfig.kubeconfigRaw)

const clientConfiguration = output({
  context: clusterName,
  contexts: {
    [clusterName]: {
      endpoints: masterNodes,
      ca: secrets.clientConfiguration.caCertificate,
      crt: secrets.clientConfiguration.clientCertificate,
      key: secrets.clientConfiguration.clientKey,
    },
  },
}).apply(JSON.stringify)

const machineSecrets = secrets.machineSecrets.apply(JSON.stringify)

function getConfiguration(machineType: string) {
  const configPatches: Input<string>[] = [globalConfigPatch]

  if (args.sharedConfigPatch && Object.keys(args.sharedConfigPatch).length > 0) {
    configPatches.push(JSON.stringify(args.sharedConfigPatch))
  }

  if (
    machineType === "controlplane" &&
    args.masterConfigPatch &&
    Object.keys(args.masterConfigPatch).length > 0
  ) {
    configPatches.push(JSON.stringify(args.masterConfigPatch))
  }

  if (
    machineType === "worker" &&
    args.workerConfigPatch &&
    Object.keys(args.workerConfigPatch).length > 0
  ) {
    configPatches.push(JSON.stringify(args.workerConfigPatch))
  }

  return machine.getConfigurationOutput({
    clusterEndpoint: apiEndpoint,
    machineSecrets: secrets.machineSecrets,
    clusterName,
    machineType,
    talosVersion: "v1.10.4",
    configPatches,
  })
}

function getConfigurationApplyArgs(
  node: common.Server,
  machineConfiguration: Output<string>,
): machine.ConfigurationApplyArgs {
  const ipEndpoint = node.endpoints.find(endpoint => endpoint.type !== "hostname")
  if (!ipEndpoint) {
    throw new Error(`No IP endpoint found for node ${node.hostname}`)
  }

  return {
    clientConfiguration: secrets.clientConfiguration,
    machineConfigurationInput: machineConfiguration,
    node: l3EndpointToString(ipEndpoint),
    configPatches: [
      JSON.stringify({
        machine: { network: { hostname: node.hostname } },
      }),
    ],
  }
}

const provider = new Provider(name, { kubeconfig })
const kubeSystem = core.v1.Namespace.get("kube-system", "kube-system", { provider })

const kubeConfig = new KubeConfig()
kubeConfig.loadFromString(await toPromise(kubeconfig))

const endpoints = uniqueBy(
  [...workers, ...masters].flatMap(server => server.endpoints),
  l3EndpointToString,
)

const apiEndpoints = uniqueBy(
  masters.flatMap(server => server.endpoints.map(endpoint => l3EndpointToL4(endpoint, 6443))),
  l4EndpointToString,
)

export default outputs({
  k8sCluster: makeEntityOutput({
    entity: k8s.clusterEntity,
    identity: kubeSystem.metadata.uid,
    meta: {
      title: clusterName,
    },
    value: {
      id: kubeSystem.metadata.uid,
      connectionId: kubeSystem.metadata.uid,

      name: clusterName,

      externalIps: endpoints
        .filter(endpoint => endpoint.type !== "hostname")
        .map(endpoint => endpoint.address),

      endpoints,
      apiEndpoints,

      quirks: {
        tunDevicePolicy: {
          type: "plugin",
          resourceName: "squat.ai/tun",
          resourceValue: "1",
        },
      },

      kubeconfig: makeEntityOutput({
        entity: common.fileEntity,
        identity: `${name}:kubeconfig`,
        meta: {
          title: "kubeconfig",
        },
        value: {
          content: {
            type: "embedded-secret",
            value: kubeconfig,
          },
          meta: {
            name: "kubeconfig",
            contentType: "text/yaml",
            mode: 0o600,
          },
        },
      }),
    },
  }),

  talosCluster: makeEntityOutput({
    entity: talos.clusterEntity,
    identity: `${name}:talos-cluster`,
    meta: {
      title: clusterName,
    },
    value: {
      clientConfiguration,
      machineSecrets,
    },
  }),

  $terminals: {
    management: {
      meta: {
        title: "Cluster Management",
        description: "Manage the cluster using kubectl and talosctl",
        icon: "devicon:talos",
      },

      spec: {
        image: "ghcr.io/highstate-io/highstate/terminal.talosctl",
        command: ["bash", "/welcome.sh"],

        files: {
          "/kubeconfig": makeFileOutput({ name: "kubeconfig", content: kubeconfig }),
          "/talosconfig": makeFileOutput({ name: "talosconfig", content: clientConfiguration }),
          "/secrets": makeFileOutput({ name: "secrets", content: machineSecrets }),

          "/welcome.sh": makeFileOutput({
            name: "welcome.sh",

            content: text`
              echo "Connecting to the cluster..."
              kubectl cluster-info

              echo "Use 'kubectl', 'helm' or 'k9s' to manage the cluster."
              echo "Use 'talosctl' to manage the Talos side of the cluster."
              echo

              exec bash
            `,
          }),
        },

        env: {
          KUBECONFIG: "/kubeconfig",
          TALOSCONFIG: "/talosconfig",
        },
      },
    },
  },

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
    apiEndpoints: apiEndpoints.map(l4EndpointToString),
  },
})
