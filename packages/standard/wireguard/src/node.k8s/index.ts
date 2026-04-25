import { createAddressSpace, l4EndpointToString, subnetToString } from "@highstate/common"
import { Namespace, NetworkPolicy, Secret, Workload } from "@highstate/k8s"
import { k8s, wireguard } from "@highstate/library"
import { forUnit, getCombinedIdentityOutput, makeEntityOutput, toPromise } from "@highstate/pulumi"
import { deepmerge } from "deepmerge-ts"
import { isNonNullish } from "remeda"
import * as images from "../../assets/images.json"
import { generateIdentityConfig, getNextAvailablePort, isExitNode, shouldExpose } from "../shared"

const { args, inputs, outputs } = forUnit(wireguard.nodeK8s)

const { identity, peers } = await toPromise(inputs)

const identityName = identity.peer.name.replaceAll(".", "-")
const appName = args.appName ?? `wg-${identityName}`

const existingWorkloads = [
  inputs.workload,
  inputs.downstreamInterface?.workload,
  inputs.fallbackInterface?.workload,
].filter(isNonNullish)

for (const workload of existingWorkloads) {
  if (workload.clusterId !== inputs.k8sCluster.id) {
    throw new Error(
      "All provided workloads must be in the same cluster as specified in inputs.k8sCluster",
    )
  }

  if (workload.metadata.namespace !== existingWorkloads[0].metadata.namespace) {
    throw new Error("All provided workloads must be in the same namespace")
  }
}

const occupiedPorts = existingWorkloads.flatMap(workload =>
  workload.spec.template.spec.containers.flatMap(
    container => container.ports?.map(port => port.containerPort) ?? [],
  ),
)

const containerPort = getNextAvailablePort(occupiedPorts, 51820)
const priority = (100000 - containerPort) % 100 // each next interface gets lower priority

const namespace = Namespace.createOrPatch(appName, {
  cluster: inputs.k8sCluster,
  resource: existingWorkloads[0],

  metadata: {
    labels: {
      "pod-security.kubernetes.io/enforce": "privileged",
    },
  },
})

const preUp: string[] = []

const postUp: string[] = [
  // enable masquerading for all traffic going out of the WireGuard node
  // TODO: consider adding more specific and restrictive rules
  "iptables -t nat -A POSTROUTING -j MASQUERADE",
]

const preDown: string[] = [
  // remove the masquerading rule
  "iptables -t nat -D POSTROUTING -j MASQUERADE",
]

// add forwarding restrictions for specified CIDRs
for (const restrictedCidr of args.forwardRestrictedSubnets) {
  // block forwarding to restricted CIDR (prevents other peers from reaching these destinations)
  postUp.push(`iptables -I FORWARD -d ${restrictedCidr} -j DROP`)
  preDown.push(`iptables -D FORWARD -d ${restrictedCidr} -j DROP`)
}

if (inputs.downstreamInterface) {
  // wait until the interface is up
  preUp.push(
    `while ! ip link show ${inputs.downstreamInterface.name} | grep -q 'UP' ; do echo "waiting for downstream interface ${inputs.downstreamInterface.name} to be up..."; sleep 1; done`,
  )

  // add a rule to route all downstream traffic to the upstream wireguard interface
  postUp.push(
    `ip rule add iif ${inputs.downstreamInterface.name} lookup ${containerPort} priority ${priority}`,
  )

  // remove the rule to route all non-encapsulated traffic to upstream wireguard interface
  preDown.push(
    `ip rule del iif ${inputs.downstreamInterface.name} lookup ${containerPort} priority ${priority}`,
  )

  // if fallback interface is provided, create default entry for it in routing table
  if (inputs.fallbackInterface) {
    preUp.push(`ip route add default dev ${inputs.fallbackInterface.name} table ${containerPort}`)
    preDown.push(`ip route del default dev ${inputs.fallbackInterface.name} table ${containerPort}`)
  }
}

const interfaceName = identityName.substring(0, 15) // linux kernel limit

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
      cluster: await toPromise(inputs.k8sCluster),
      network: identity.peer.network,
      table: inputs.downstreamInterface ? containerPort : undefined, // use the same table number as its port to avoid conflicts
    }),
  },
})

const workload = await toPromise(
  Workload.createOrPatchGeneric(appName, {
    defaultType: "Deployment",
    namespace,

    existing: inputs.workload ?? inputs.downstreamInterface?.workload,

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
          },
        }
      : undefined,
  }),
)

if (shouldExpose(identity, args.exposePolicy)) {
  new NetworkPolicy("allow-wireguard-ingress", {
    namespace,
    selector: workload.selector,

    description: "Allow encapsulated WireGuard traffic to the node from anywhere.",

    ingressRule: {
      fromAll: true,
    },
  })
}

if (isExitNode(identity.peer)) {
  new NetworkPolicy("allow-all-egress", {
    namespace,
    selector: workload.selector,

    description: "Allow all egress traffic from the WireGuard node since it is an exit node.",

    egressRule: {
      toAll: true,
    },
  })
}

const pureAllowedSpace = createAddressSpace({
  included: identity.peer.allowedSubnets,
  excluded: identity.peer.addresses,
})

// allow egress to the subnets that are not part of the peer's addresses
if (pureAllowedSpace.subnets.length > 0) {
  new NetworkPolicy("allow-egress-to-allowed-subnets", {
    namespace,
    selector: workload.selector,

    description: "Allow egress traffic from the WireGuard node to its allowed subnets.",

    egressRule: {
      toCidrs: pureAllowedSpace.subnets.map(subnetToString),
    },
  })
}

for (const peer of peers) {
  if (!peer.endpoints.length) {
    continue
  }

  new NetworkPolicy(`allow-egress-to-peer-${peer.name}`, {
    namespace,
    selector: workload.selector,

    description: `Allow egress traffic from the WireGuard node to the endpoints of the peer "${peer.name}".`,

    egressRule: {
      toEndpoints: peer.endpoints,
    },
  })
}

if (args.allowClusterPods) {
  new NetworkPolicy("allow-egress-to-cluster-pods", {
    namespace,
    egressRule: { toClusterPods: true },
  })
}

const endpoints = await toPromise(
  workload.optionalService.apply(service => service?.endpoints ?? []),
)

export default outputs({
  workload: workload.entity,

  interface: makeEntityOutput({
    entity: k8s.networkInterfaceEntity,
    identity: getCombinedIdentityOutput([workload.entity, interfaceName]),
    meta: {
      title: interfaceName,
    },
    value: {
      name: interfaceName,
      workload: workload.entity,
    },
  }),

  peer: {
    ...identity.peer,
    endpoints,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },

  $terminals: [workload.terminal],
})
