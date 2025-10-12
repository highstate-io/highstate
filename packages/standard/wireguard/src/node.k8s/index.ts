import { l4EndpointToString, l34EndpointToString, updateEndpoints } from "@highstate/common"
import { ExposableWorkload, Namespace, NetworkPolicy, Secret } from "@highstate/k8s"
import { wireguard } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
import * as images from "../../assets/images.json"
import { generateIdentityConfig, isExitNode, shouldExpose } from "../shared"

const { args, inputs, outputs } = forUnit(wireguard.nodeK8s)

const { identity, peers } = await toPromise(inputs)

const identityName = identity.peer.name.replaceAll(".", "-")
const appName = args.appName ?? `wg-${identityName}`

const namespace = Namespace.createOrPatch(appName, {
  cluster: inputs.k8sCluster,
  resource: inputs.workload ?? inputs.interface?.workload,

  metadata: {
    labels: {
      "pod-security.kubernetes.io/enforce": "privileged",
    },
  },
})

const downstreamInterface = await toPromise(inputs.interface)

const preUp: string[] = [
  // idk why
  "sleep 5",
]

const postUp: string[] = [
  // enable masquerading for all traffic going out of the WireGuard node
  // TODO: consider adding more specific and restrictive rules
  "iptables -t nat -A POSTROUTING -j MASQUERADE",
]

const preDown: string[] = [
  // remove the masquerading rule
  "iptables -t nat -D POSTROUTING -j MASQUERADE",
]

// Add forwarding restrictions for specified CIDRs
for (const restrictedCidr of args.forwardRestrictedIps) {
  // Block forwarding to restricted CIDR (prevents other peers from reaching these destinations)
  postUp.push(`iptables -I FORWARD -d ${restrictedCidr} -j DROP`)
  preDown.push(`iptables -D FORWARD -d ${restrictedCidr} -j DROP`)
}

if (downstreamInterface) {
  // wait until the interface is up
  preUp.push(`while ! ip link show ${downstreamInterface.name} | grep -q 'UP' ; do sleep 1; done`)

  // remove the default rule to route all non-encapsulated traffic to upstream wireguard interface
  postUp.push("ip rule del not from all fwmark 0xca6c lookup 51820")

  // add a rule to route all downstream traffic to the upstream wireguard interface
  postUp.push("ip rule add from all fwmark 0x1 lookup 51820")

  // mark all downstream traffic with 0x1
  postUp.push(
    `iptables -t mangle -A PREROUTING -i ${downstreamInterface.name} -j MARK --set-mark 0x1`,
  )

  // remove the rule to route all downstream traffic to the upstream wireguard interface
  preDown.push(
    `iptables -t mangle -D PREROUTING -i ${downstreamInterface.name} -j MARK --set-mark 0x1`,
  )

  // remove the rule to route all non-encapsulated traffic to upstream wireguard interface
  preDown.push("ip rule del from all fwmark 0x1 lookup 51820")
}

const interfaceName = identityName.substring(0, 15) // linux kernel limit

// if there is a workload, we will use a different port to prevent potential conflicts
const containerPort = (inputs.workload ?? inputs.interface?.workload) ? 51821 : 51820

const configSecret = Secret.create(appName, {
  namespace,

  stringData: {
    [`${interfaceName}.conf`]: generateIdentityConfig({
      identity,
      peers,
      listenPort: containerPort,
      preUp,
      postUp,
      preDown,
      defaultInterface: "eth0",
      cluster: await toPromise(inputs.k8sCluster),
    }),
  },
})

const workload = ExposableWorkload.createOrPatchGeneric(appName, {
  type: "Deployment",
  namespace,

  existing: inputs.workload ?? inputs.interface?.workload,

  container: deepmerge(
    {
      image: images.wireguard.image,

      environment: {
        PUID: "1000",
        PGID: "1000",
        TZ: "Etc/UTC",
      },

      securityContext: {
        capabilities: {
          add: ["NET_ADMIN"],
        },
      },

      port: {
        containerPort,
        protocol: "UDP",
      },

      volumeMount: {
        volume: configSecret,
        mountPath: "/config/wg_confs",
      },
    },
    args.containerSpec ?? {},
  ),

  service: shouldExpose(identity, args.exposePolicy)
    ? {
        external: args.external,
        port: {
          port: identity.peer.listenPort ?? 51820,
          targetPort: containerPort,
          protocol: "UDP",
          nodePort: args.external ? identity.peer.listenPort : undefined,
        },
      }
    : undefined,
})

if (shouldExpose(identity, args.exposePolicy)) {
  new NetworkPolicy("allow-wireguard-ingress", {
    namespace,
    selector: workload.spec.selector,

    description: "Allow encapsulated WireGuard traffic to the node from anywhere.",

    ingressRule: {
      fromAll: true,
    },
  })
}

if (isExitNode(identity.peer)) {
  new NetworkPolicy("allow-all-egress", {
    namespace,
    selector: workload.spec.selector,

    description: "Allow all egress traffic from the WireGuard node since it is an exit node.",

    egressRule: {
      toAll: true,
    },
  })
}

for (const endpoint of identity.peer.allowedEndpoints) {
  new NetworkPolicy(`allow-egress-to-${l34EndpointToString(endpoint)}`, {
    namespace,
    selector: workload.spec.selector,

    description: `Allow egress traffic from the WireGuard node to the allowed endpoint "${l34EndpointToString(endpoint)}".`,

    egressRule: {
      toEndpoint: endpoint,
    },
  })
}

for (const peer of peers) {
  if (!peer.endpoints.length) {
    continue
  }

  new NetworkPolicy(`allow-egress-to-peer-${peer.name}`, {
    namespace,
    selector: workload.spec.selector,

    description: `Allow egress traffic from the WireGuard node to the endpoints of the peer "${peer.name}".`,

    egressRule: {
      toEndpoints: peer.endpoints,
    },
  })
}

const endpoints = await updateEndpoints(
  identity.peer.endpoints,
  [],
  output(workload.optionalService.apply(service => service?.endpoints ?? [])),
  "prepend",
)

export default outputs({
  interface: {
    name: interfaceName,
    workload: workload.entity,
  },
  peer: {
    ...identity.peer,
    endpoints,
  },
  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $terminals: [workload.terminal],
})
