import { posix } from "node:path"
import { l7EndpointToString } from "@highstate/common"
import { Namespace, NetworkPolicy, Secret, Workload } from "@highstate/k8s"
import { k8s, wireguard } from "@highstate/library"
import {
  forUnit,
  getCombinedIdentityOutput,
  makeEntityOutput,
  secret,
  toPromise,
} from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
import images from "../../assets/images.json"
import { generateFeedDaemonConfigContent } from "../shared"

const { name, args, inputs, outputs } = forUnit(wireguard.nodeFeedK8s)

const existingWorkload = inputs.workload ?? inputs.interface?.workload

const appName = (args.appName ?? `wg-${name}`).replaceAll(".", "-")

const namespace = Namespace.createOrPatch(appName, {
  cluster: inputs.k8sCluster,
  resource: inputs.workload ?? inputs.interface?.workload,

  metadata: {
    labels: {
      "pod-security.kubernetes.io/enforce": "privileged",
    },
  },
})

const peer = inputs.peer ? await toPromise(inputs.peer) : undefined

const endpoints = await toPromise(inputs.endpoints ?? [])
if (endpoints.length === 0) {
  throw new Error("At least one endpoint must be provided via inputs.endpoints")
}

const setupUrls = endpoints.map(l7EndpointToString)

const configPath = "/etc/wg-feed/config.yaml"
const stateDirectory = posix.dirname(args.statePath)
const configContent = generateFeedDaemonConfigContent({
  statePath: args.statePath,
  feedName: args.feedName,
  backendName: args.backendName,
  backendType: args.backendType,
  syncMode: args.syncMode,
  pollingInterval: args.pollingInterval,
  endpoints: setupUrls,
  enabledTunnels: args.enabledTunnels,
})

const configSecret = Secret.create(appName, {
  namespace,

  stringData: {
    "config.yaml": secret(configContent),
  },
})

const stateVolume = {
  name: "wg-feed-state",
  emptyDir: {},
}

const initCommands: string[] = []

// add forwarding restrictions for specified CIDRs
for (const restrictedCidr of args.forwardRestrictedSubnets) {
  // block forwarding to restricted CIDR (prevents other peers from reaching these destinations)
  initCommands.push(`iptables -I FORWARD -d ${restrictedCidr} -j DROP`)
}

if (args.lockdownUpstream) {
  // add a catch-all rule to drop all traffic from the interface to prevent leaks before downstream interface is attached
  initCommands.push(`ip route add blackhole default table 100`)
  initCommands.push(`ip rule add iif ${args.interfaceName} lookup 100 priority 100`)
}

const workload = await toPromise(
  Workload.createOrPatchGeneric(appName, {
    defaultType: "Deployment",
    namespace,
    existing: existingWorkload,

    initContainer: {
      name: "init",
      image: images.wgFeedDaemon.image,
      command: ["sh", "-c", initCommands.join(" && ")],
      securityContext: {
        runAsUser: 0,
        runAsGroup: 0,
        runAsNonRoot: false,
        capabilities: {
          add: ["NET_ADMIN"],
        },
      },
    },

    container: deepmerge(
      {
        name: "wg-feed-daemon",
        image: images.wgFeedDaemon.image,

        securityContext: {
          runAsUser: 0,
          runAsGroup: 0,
          runAsNonRoot: false,
          capabilities: {
            add: ["NET_ADMIN"],
          },
        },

        port: {
          containerPort: args.listenPort,
          protocol: "UDP",
        },

        args: ["--config", configPath],

        volumeMounts: [
          {
            volume: configSecret,
            mountPath: "/etc/wg-feed",
            readOnly: true,
          },
          {
            volume: stateVolume,
            mountPath: stateDirectory,
          },
        ],
      },
      args.containerSpec ?? {},
    ),

    service: args.expose
      ? {
          external: args.external,
          port: {
            port: args.listenPort,
            targetPort: args.listenPort,
            protocol: "UDP",
            nodePort: args.nodePort,
          },
        }
      : undefined,
  }),
)

if (args.expose) {
  new NetworkPolicy("allow-wireguard-ingress", {
    namespace,
    selector: workload.selector,

    description: "Allow encapsulated WireGuard traffic to the node from anywhere.",

    ingressRule: {
      fromAll: true,
    },
  })
}

new NetworkPolicy("allow-all-egress", {
  namespace,
  selector: workload.selector,

  description:
    "Allow all egress traffic from the wg-feed daemon since its peer endpoints are not known ahead of time.",

  egressRule: {
    toAll: true,
  },
})

const exposedEndpoints = await toPromise(
  workload.optionalService.apply(service => service?.endpoints ?? []),
)

export default outputs({
  workload: workload.entity,

  interface: makeEntityOutput({
    entity: k8s.networkInterfaceEntity,
    identity: getCombinedIdentityOutput([workload.entity, args.interfaceName]),
    meta: {
      title: args.interfaceName,
    },
    value: {
      name: args.interfaceName,
      workload: workload.entity,
    },
  }),

  peer: peer
    ? {
        ...peer,
        endpoints: exposedEndpoints,
      }
    : undefined,

  $terminals: [workload.terminal],
})
