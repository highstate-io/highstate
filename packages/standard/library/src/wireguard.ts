import { defineEntity, defineUnit, z } from "@highstate/contract"
import { omit } from "remeda"
import { serverEntity } from "./common/server"
import { clusterEntity, exposableWorkloadEntity, networkInterfaceEntity } from "./k8s"
import { l3EndpointEntity, l4EndpointEntity } from "./network"
import { arrayPatchModeSchema } from "./utils"

export const backendSchema = z.enum(["wireguard", "amneziawg"])

export type Backend = z.infer<typeof backendSchema>

const networkArgs = {
  /**
   * The backend to use for the WireGuard network.
   *
   * Possible values are:
   * - `wireguard` - the default backend;
   * - `amneziawg` - the censorship-resistant fork of WireGuard.
   */
  backend: backendSchema.default("wireguard"),

  /**
   * Whether to enable IPv4 support in the network.
   *
   * By default, IPv4 support is enabled.
   */
  ipv4: z.boolean().default(true),

  /**
   * Whether to enable IPv6 support in the network.
   *
   * By default, IPv6 support is disabled.
   */
  ipv6: z.boolean().default(false),
}

/**
 * The entity representing the WireGuard network configuration.
 *
 * It holds shared configuration for WireGuard identities, peers, and nodes.
 */
export const networkEntity = defineEntity({
  type: "wireguard.network.v1",

  schema: z.object(networkArgs),
})

export const nodeExposePolicySchema = z.enum(["always", "when-has-endpoint", "never"])

export const peerEntity = defineEntity({
  type: "wireguard.peer.v1",

  schema: z.object({
    name: z.string(),
    network: networkEntity.schema.optional(),
    publicKey: z.string(),
    address: z.string().optional(),
    allowedIps: z.string().array(),
    endpoints: l4EndpointEntity.schema.array(),
    allowedEndpoints: z.union([l3EndpointEntity.schema, l4EndpointEntity.schema]).array(),

    /**
     * The pre-shared key of the WireGuard peer.
     *
     * If one of two peers has `presharedKey` set, the other peer must have `presharedKey` set too and they must be equal.
     *
     * Will be ignored if both peers have `presharedKeyPart` set.
     */
    presharedKey: z.string().optional(),

    /**
     * The pre-shared key part of the WireGuard peer.
     *
     * If both peers have `presharedKeyPart` set, their `presharedKey` will be calculated as XOR of the two parts.
     */
    presharedKeyPart: z.string().optional(),

    excludedIps: z.string().array(),
    dns: z.string().array(),
    listenPort: z.number().optional(),

    /**
     * The keepalive interval in seconds that will be used by all nodes connecting to this peer.
     *
     * If set to 0, keepalive is disabled.
     */
    persistentKeepalive: z.number().int().nonnegative().default(0),
  }),

  meta: {
    color: "#673AB7",
  },
})

export const identityEntity = defineEntity({
  type: "wireguard.identity.v1",

  schema: z.object({
    peer: peerEntity.schema,
    privateKey: z.string(),
  }),

  meta: {
    color: "#F44336",
  },
})

export type Network = z.infer<typeof networkEntity.schema>
export type Identity = z.infer<typeof identityEntity.schema>
export type Peer = z.infer<typeof peerEntity.schema>
export type NodeExposePolicy = z.infer<typeof nodeExposePolicySchema>

/**
 * Holds the shared configuration for WireGuard identities, peers, and nodes.
 */
export const network = defineUnit({
  type: "wireguard.network.v1",

  args: networkArgs,

  outputs: {
    network: networkEntity,
  },

  meta: {
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:local-area-network-connect",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "network",
  },
})

const sharedPeerArgs = {
  /**
   * The name of the WireGuard peer.
   *
   * If not provided, the peer will be named after the unit.
   */
  peerName: z.string().optional(),

  /**
   * The address of the WireGuard interface.
   *
   * The address may be any IPv4 or IPv6 address. CIDR notation is also supported.
   */
  address: z.string().optional(),

  /**
   * The convenience option to set `allowedIps` to `0.0.0.0/0, ::/0`.
   *
   * Will be merged with the `allowedIps` if provided.
   */
  exitNode: z.boolean().default(false),

  /**
   * The list of IP ranges to exclude from the tunnel.
   *
   * Implementation notes:
   *
   * - this list will not be used to generate the allowed IPs for the peer;
   * - instead, the node will setup extra direct routes to these IPs via default gateway;
   * - this allows to use `0.0.0.0/0, ::/0` in the `allowedIps` (and corresponding fwmark magic) and still have some IPs excluded from the tunnel.
   */
  excludedIps: z.string().array().default([]),

  /**
   * The convenience option to exclude private IPs from the tunnel.
   *
   * For IPv4, the private IPs are:
   *
   * - `10.0.0.0/8`
   * - `172.16.0.0/12`
   * - `192.168.0.0/16`
   *
   * For IPv6, the private IPs are:
   *
   * - `fc00::/7`
   * - `fe80::/10`
   *
   * Will be merged with `excludedIps` if provided.
   */
  excludePrivateIps: z.boolean().default(false),

  /**
   * The endpoints of the WireGuard peer.
   */
  endpoints: z.string().array().default([]),

  /**
   * The allowed endpoints of the WireGuard peer.
   *
   * The non `hostname` endpoints will be added to the `allowedIps` of the peer.
   */
  allowedEndpoints: z.string().array().default([]),

  /**
   * The DNS servers that should be used by the interface connected to the WireGuard peer.
   *
   * If multiple peers define DNS servers, the node will merge them into a single list (but this is discouraged).
   */
  dns: z.string().array().default([]),

  /**
   * The convenience option to include the DNS servers to the allowed IPs.
   *
   * By default, is `true`.
   */
  includeDns: z.boolean().default(true),

  /**
   * The port to listen on.
   */
  listenPort: z.number().optional(),
}

const sharedPeerInputs = {
  /**
   * The network to use for the WireGuard identity.
   *
   * If not provided, the identity will use default network configuration.
   */
  network: {
    entity: networkEntity,
    required: false,
  },

  /**
   * The L3 endpoints of the identity.
   *
   * Will produce L4 endpoints for each of the provided L3 endpoints.
   */
  l3Endpoints: {
    entity: l3EndpointEntity,
    multiple: true,
    required: false,
  },

  /**
   * The L4 endpoints of the identity.
   *
   * Will take priority over all calculated endpoints if provided.
   */
  l4Endpoints: {
    entity: l4EndpointEntity,
    required: false,
    multiple: true,
  },

  /**
   * The L3 endpoints to add to the allowed IPs of the identity.
   *
   * `hostname` endpoints will be ignored.
   *
   * If the endpoint contains k8s service metadata of the cluster where the identity node is deployed,
   * the corresponding network policy will be created.
   */
  allowedL3Endpoints: {
    entity: l3EndpointEntity,
    multiple: true,
    required: false,
  },

  /**
   * The L4 endpoints to add to the allowed IPs of the identity.
   *
   * If the endpoint contains k8s service metadata of the cluster where the identity node is deployed,
   * the corresponding network policy will be created.
   */
  allowedL4Endpoints: {
    entity: l4EndpointEntity,
    multiple: true,
    required: false,
  },
} as const

const sharedPeerOutputs = {
  peer: peerEntity,

  endpoints: {
    entity: l4EndpointEntity,
    required: false,
    multiple: true,
  },
} as const

export type SharedPeerArgs = {
  peerName?: string
  address?: string
  exitNode: boolean
  excludedIps: string[]
  excludePrivateIps: boolean
  endpoints: string[]
  allowedEndpoints: string[]
  dns: string[]
  includeDns: boolean
  listenPort?: number
}

/**
 * The WireGuard peer with the public key.
 */
export const peer = defineUnit({
  type: "wireguard.peer.v1",

  args: {
    ...sharedPeerArgs,

    /**
     * The public key of the WireGuard peer.
     */
    publicKey: z.string(),
  },

  secrets: {
    /**
     * The pre-shared key which should be used for the peer.
     */
    presharedKey: z.string().optional(),
  },

  inputs: sharedPeerInputs,
  outputs: sharedPeerOutputs,

  meta: {
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:badge-account-horizontal",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "peer",
  },
})

/**
 * Patches some properties of the WireGuard peer.
 */
export const peerPatch = defineUnit({
  type: "wireguard.peer-patch.v1",

  args: {
    /**
     * The endpoints of the WireGuard peer.
     */
    endpoints: z.string().array().default([]),

    /**
     * The mode to use for patching the endpoints.
     *
     * - `prepend`: prepend the new endpoints to the existing ones (default);
     * - `replace`: replace the existing endpoints with the new ones.
     */
    endpointsPatchMode: arrayPatchModeSchema.default("prepend"),

    /**
     * The allowed endpoints of the WireGuard peer.
     *
     * The non `hostname` endpoints will be added to the `allowedIps` of the peer.
     */
    allowedEndpoints: z.string().array().default([]),

    /**
     * The mode to use for patching the allowed endpoints.
     *
     * - `prepend`: prepend the new endpoints to the existing ones (default);
     * - `replace`: replace the existing endpoints with the new ones.
     */
    allowedEndpointsPatchMode: arrayPatchModeSchema.default("prepend"),

    ...omit(sharedPeerArgs, ["endpoints", "allowedEndpoints"]),
  },

  inputs: {
    peer: peerEntity,
    ...sharedPeerInputs,
  },

  outputs: {
    peer: peerEntity,

    endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  meta: {
    title: "WireGuard Peer Patch",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:badge-account-horizontal",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "peer-patch",
  },
})

/**
 * The WireGuard identity with the public key.
 */
export const identity = defineUnit({
  type: "wireguard.identity.v1",

  args: {
    ...sharedPeerArgs,

    /**
     * The port to listen on.
     *
     * Used by the implementation of the identity and to calculate the endpoint of the peer.
     */
    listenPort: z.number().optional(),

    /**
     * The endpoint of the WireGuard peer.
     *
     * If overridden, does not affect node which implements the identity, but is used in the peer configuration of other nodes.
     *
     * Will take priority over all calculated endpoints and `l4Endpoint` input.
     */
    endpoints: z.string().array().default([]),
  },

  secrets: {
    /**
     * The private key of the WireGuard identity.
     *
     * If not provided, the key will be generated automatically.
     */
    privateKey: z.string().optional(),

    /**
     * The part of the pre-shared of the WireGuard identity.
     *
     * Will be generated automatically if not provided.
     */
    presharedKeyPart: z.string().optional(),
  },

  inputs: sharedPeerInputs,

  outputs: {
    identity: identityEntity,
    ...sharedPeerOutputs,
  },

  meta: {
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:account",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "identity",
  },
})

/**
 * The WireGuard node deployed in the Kubernetes cluster.
 */
export const nodeK8s = defineUnit({
  type: "wireguard.node.k8s.v1",

  args: {
    /**
     * The name of the namespace/deployment/statefulset where the WireGuard node will be deployed.
     *
     * By default, the name is `wg-${identity.name}`.
     */
    appName: z.string().optional(),

    /**
     * Whether to expose the WireGuard node to the outside world.
     */
    external: z.boolean().default(false),

    /**
     * The policy to use for exposing the WireGuard node.
     *
     * - `always` - The node will be exposed and the service will be created.
     * - `when-has-endpoint` - The node will be exposed only if the provided idenity has at least one endpoint.
     * - `never` - The node will not be exposed and the service will not be created.
     *
     * * By default, the `when-has-endpoint` policy is used.
     */
    exposePolicy: nodeExposePolicySchema.default("when-has-endpoint"),

    /**
     * The extra specification of the container which runs the WireGuard node.
     *
     * Will override any overlapping fields.
     */
    containerSpec: z.record(z.string(), z.unknown()).optional(),

    /**
     * List of CIDR blocks that should be blocked from forwarding through this WireGuard node.
     *
     * This prevents other peers from reaching these destination CIDRs while still allowing
     * the peers in those CIDRs to access the internet and other allowed endpoints.
     *
     * Useful for peer isolation where you want to prevent cross-peer communication.
     */
    forwardRestrictedIps: z.string().array().default([]),
  },

  inputs: {
    identity: identityEntity,
    k8sCluster: clusterEntity,

    workload: {
      entity: exposableWorkloadEntity,
      required: false,
    },

    interface: {
      entity: networkInterfaceEntity,
      required: false,
    },

    peers: {
      entity: peerEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    interface: {
      entity: networkInterfaceEntity,
      required: false,
    },

    peer: {
      entity: peerEntity,
      required: false,
    },

    endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  meta: {
    title: "WireGuard Kubernetes Node",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "devicon:kubernetes",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "node.k8s",
  },
})

/**
 * The WireGuard node deployed on a server using wg-quick systemd service.
 */
export const node = defineUnit({
  type: "wireguard.node.v1",

  args: {
    /**
     * The name of the WireGuard interface.
     *
     * By default, the name is `wg-${identity.name}` (truncated to 15 characters).
     */
    interfaceName: z.string().optional(),

    /**
     * The name of the default interface for excluded routes.
     *
     * This is used to route excluded IPs through the default interface instead of the WireGuard tunnel.
     */
    defaultInterface: z.string().default("eth0"),

    /**
     * List of CIDR blocks that should be blocked from forwarding through this WireGuard node.
     *
     * This prevents other peers from reaching these destination CIDRs while still allowing
     * the peers in those CIDRs to access the internet and other allowed endpoints.
     *
     * Useful for peer isolation where you want to prevent cross-peer communication.
     */
    forwardRestrictedIps: z.string().array().default([]),

    /**
     * Whether to enable IP masquerading (NAT) for outgoing traffic.
     *
     * By default, IP masquerading is enabled.
     */
    enableMasquerade: z.boolean().default(true),

    /**
     * Script to run before bringing up the interface.
     */
    preUpScript: z.string().optional().meta({ language: "shell" }),

    /**
     * Script to run after bringing up the interface.
     */
    postUpScript: z.string().optional().meta({ language: "shell" }),

    /**
     * Script to run before bringing down the interface.
     */
    preDownScript: z.string().optional().meta({ language: "shell" }),

    /**
     * Script to run after bringing down the interface.
     */
    postDownScript: z.string().optional().meta({ language: "shell" }),
  },

  inputs: {
    identity: identityEntity,
    server: {
      entity: serverEntity,
      required: true,
    },

    peers: {
      entity: peerEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    peer: {
      entity: peerEntity,
      required: false,
    },

    endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  meta: {
    title: "WireGuard Server Node",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:server",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "node",
  },
})

/**
 * Just the WireGuard configuration for the identity and peers.
 */
export const config = defineUnit({
  type: "wireguard.config.v1",

  args: {
    /**
     * The name of the "default" interface where non-tunneled traffic should go.
     *
     * If not provided, the config will not respect `excludedIps`.
     */
    defaultInterface: z.string().optional(),
  },

  inputs: {
    identity: identityEntity,
    peers: {
      entity: peerEntity,
      multiple: true,
      required: false,
    },
  },

  meta: {
    title: "WireGuard Config",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:settings",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "config",
  },
})

/**
 * The WireGuard configuration bundle for the identity and peers.
 */
export const configBundle = defineUnit({
  type: "wireguard.config-bundle.v1",

  inputs: {
    identity: identityEntity,
    peers: {
      entity: peerEntity,
      multiple: true,
    },
    sharedPeers: {
      entity: peerEntity,
      multiple: true,
      required: false,
    },
  },

  meta: {
    title: "WireGuard Config Bundle",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:folder-settings-variant",
    category: "VPN",
  },

  source: {
    package: "@highstate/wireguard",
    path: "config-bundle",
  },
})
