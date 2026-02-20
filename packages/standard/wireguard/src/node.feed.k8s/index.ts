import { l7EndpointToString } from "@highstate/common"
import { ExposableWorkload, Namespace, NetworkPolicy, Secret, Workload } from "@highstate/k8s"
import { wireguard } from "@highstate/library"
import { forUnit, secret, toPromise } from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
import * as images from "../../assets/images.json"

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

const setupUrls = endpoints.map(l7EndpointToString).join(",")

const setupUrlsSecret = Secret.create(appName, {
  namespace,

  stringData: {
    setup_urls: secret(setupUrls),
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

// TODO: add init container with commands

const workload = await toPromise(
  Workload.createOrPatchGeneric(appName, {
    defaultType: "Deployment",
    namespace,
    existing: existingWorkload,

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

        env: [
          {
            name: "BACKEND",
            value: "wg-quick",
          },
          {
            name: "SETUP_URLS",
            valueFrom: {
              secretKeyRef: {
                name: setupUrlsSecret.metadata.name,
                key: "setup_urls",
              },
            },
          },
        ],

        environment: {
          STATE_PATH: "/state/state.json",
        },

        volumeMount: {
          volume: stateVolume,
          mountPath: "/state",
        },
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
          },
        }
      : undefined,
  }),
)

if (args.expose && workload instanceof ExposableWorkload) {
  new NetworkPolicy("allow-wireguard-ingress", {
    namespace,
    selector: workload.spec.selector,

    description: "Allow encapsulated WireGuard traffic to the node from anywhere.",

    ingressRule: {
      fromAll: true,
    },
  })
}

if (workload instanceof ExposableWorkload) {
  new NetworkPolicy("allow-all-egress", {
    namespace,
    selector: workload.spec.selector,

    description:
      "Allow all egress traffic from the wg-feed daemon since its peer endpoints are not known ahead of time.",

    egressRule: {
      toAll: true,
    },
  })
}

const exposedEndpoints = await toPromise(
  workload instanceof ExposableWorkload
    ? workload.optionalService.apply(service => service?.endpoints ?? [])
    : [],
)

export default outputs({
  workload: workload.entity,

  interface: {
    name: args.interfaceName,
    workload: workload.entity,
  },

  peer: peer
    ? {
        ...peer,
        endpoints: exposedEndpoints,
      }
    : undefined,

  $terminals: [workload.terminal],
})
