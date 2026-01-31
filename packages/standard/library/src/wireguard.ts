import {
  $args,
  $inputs,
  $outputs,
  defineEntity,
  defineUnit,
  genericNameSchema,
  z,
} from "@highstate/contract"
import { pick } from "remeda"
import { fileEntity } from "./common"
import { serverEntity } from "./common/server"
import { etcdEntity } from "./databases"
import { clusterEntity, networkInterfaceEntity, workloadEntity } from "./k8s"
import {
  addressEntity,
  l3EndpointEntity,
  l4EndpointEntity,
  l7EndpointEntity,
  subnetEntity,
} from "./network"
import { toPatchArgs } from "./utils"

export const backendSchema = z.enum(["wireguard", "amneziawg"])

export type Backend = z.infer<typeof backendSchema>

const networkArgs = {
  /**
   * The backend to use for the WireGuard network.
   *
   * Possible values are:
   * - `wireguard` - the default backend;
   * - `amneziawg` - the censorship-resistant fork of WireGuard (NOT SUPPORTED YET).
   */
  backend: backendSchema.default("wireguard"),

  /**
   * Whether to enable IPv4 support in the network.
   * Affects addresses inside network, not the endpoints of peers.
   *
   * By default, IPv4 support is enabled.
   */
  ipv4: z.boolean().default(true),

  /**
   * Whether to enable IPv6 support in the network.
   * Affects addresses inside network, not the endpoints of peers.
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

  includes: {
    /**
     * The endpoints where the WireGuard peer can be reached.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the WireGuard peer.
     */
    name: genericNameSchema,

    /**
     * The network to which the WireGuard peer belongs.
     *
     * Holds shared configuration for all identities, peers, and nodes.
     */
    network: networkEntity.schema.optional(),

    /**
     * The addresses of the WireGuard interface.
     */
    addresses: addressEntity.schema.array(),

    /**
     * The allowed subnets of the WireGuard peer.
     *
     * Will be used to configure the `AllowedIPs` of the peer.
     */
    allowedSubnets: subnetEntity.schema.array(),

    /**
     * The public key of the WireGuard peer.
     */
    publicKey: z.string(),

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
     * If both peers have `presharedKeyPart` set, their `presharedKey` will be calculated as sha256 of the two parts.
     */
    presharedKeyPart: z.string().optional(),

    /**
     * The list of DNS servers to setup for the interface connected to the WireGuard peer.
     */
    dns: addressEntity.schema.array(),

    /**
     * The port where the WireGuard peer is listening.
     *
     * Will be used:
     * 1. For implementations if the listen port is not set elsewhere.
     * 2. To map L3 endpoints to L4 endpoints with this port.
     */
    listenPort: z.number().default(51820),

    /**
     * The keepalive interval in seconds that will be used by all nodes connecting to this peer.
     *
     * If set to 0, keepalive is disabled.
     */
    persistentKeepalive: z.number().int().nonnegative().default(0),

    /**
     * The peers which are relayed through this peer.
     *
     * All their allowed IPs will be added to this peer's allowed IPs
     * and will be used to setup routing for all other peers except the relayed ones.
     */
    get relayedPeers() {
      return peerEntity.schema.array().optional()
    },
  }),

  meta: {
    color: "#673AB7",
  },
})

export const identityEntity = defineEntity({
  type: "wireguard.identity.v1",

  includes: {
    /**
     * The WireGuard peer representing this identity.
     */
    peer: peerEntity,
  },

  schema: z.object({
    /**
     * The private key of the WireGuard identity.
     */
    privateKey: z.string(),
  }),

  meta: {
    color: "#F44336",
  },
})

export const feedDisplayInfoSchema = z.object({
  /**
   * The display title of the tunnel.
   */
  title: z.string(),

  /**
   * The display description of the tunnel.
   */
  description: z.string().optional(),

  /**
   * The display icon URL of the tunnel.
   *
   * Must only be `data:` URL with SVG image.
   */
  iconUrl: z.url().optional(),
})

export const feedMetadataSchema = z.object({
  /**
   * The ID of the tunnel in the feed.
   */
  id: z.string(),

  /**
   * The suggested name of the interface for the tunnel.
   */
  name: genericNameSchema,

  /**
   * The display information of the tunnel.
   */
  displayInfo: feedDisplayInfoSchema,
})

export const configEntity = defineEntity({
  type: "wireguard.config.v1",

  includes: {
    /**
     * The file containing the wg-quick configuration.
     */
    file: fileEntity,
  },

  schema: z.object({
    /**
     * The metadata to include in the wg-feed for this config.
     *
     * Must be provided for the configs uploaded to wg-feed.
     */
    feedMetadata: feedMetadataSchema.optional(),
  }),
})

export type Network = z.infer<typeof networkEntity.schema>
export type Identity = z.infer<typeof identityEntity.schema>
export type Peer = z.infer<typeof peerEntity.schema>
export type NodeExposePolicy = z.infer<typeof nodeExposePolicySchema>
export type Config = z.infer<typeof configEntity.schema>

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

const sharedPeerArgs = $args({
  /**
   * The name of the WireGuard peer.
   *
   * If not provided, the peer will be named after the unit.
   */
  peerName: z.string().optional(),

  /**
   * The addresses of the WireGuard interface.
   *
   * The address may be any IPv4 or IPv6 address. CIDR notation is also supported.
   */
  addresses: z.string().array().default([]),

  /**
   * The convenience option to set `allowedIps` to `0.0.0.0/0, ::/0`.
   *
   * Will be merged with the `allowedIps` if provided.
   */
  exitNode: z.boolean().default(false),

  /**
   * The list of IP ranges to include in the allowed IPs of the peer.
   */
  allowedSubnets: z.string().array().default([]),

  /**
   * The list of IP ranges to exclude from the tunnel.
   */
  excludedSubnets: z.string().array().default([]),

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
  excludePrivateSubnets: z.boolean().default(false),

  /**
   * The endpoints of the WireGuard peer.
   */
  endpoints: z.string().array().default([]),

  /**
   * The DNS servers that should be used by the interface connected to the WireGuard peer.
   *
   * If multiple peers define DNS servers, the node will merge them into a single list (but this is discouraged).
   */
  dns: z.string().array().default([]),

  /**
   * The convenience option to include the addresses to the allowed IPs.
   *
   * By default, is `true`.
   */
  includeAddresses: z.boolean().default(true),

  /**
   * The convenience option to include the DNS servers to the allowed IPs.
   *
   * By default, is `true`.
   */
  includeDns: z.boolean().default(true),

  /**
   * The port to listen on.
   */
  listenPort: z.number().default(51820),

  /**
   * The keepalive interval in seconds that will be used by all nodes connecting to this peer.
   *
   * If set to 0, keepalive is disabled.
   */
  persistentKeepalive: z.number().int().nonnegative().default(0),
})

const sharedPeerInputs = $inputs({
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
   * The L3/L4 endpoints of the identity.
   *
   * All L3 endpoints will be adjusted to L4 endpoints with listen port of the identity.
   */
  endpoints: {
    entity: l3EndpointEntity,
    multiple: true,
    required: false,
  },

  /**
   * the endpoints to add to the allowed IPs of the identity.
   */
  allowedEndpoints: {
    entity: l3EndpointEntity,
    multiple: true,
    required: false,
  },

  /**
   * The subnets to add to the allowed IPs of the identity.
   */
  allowedSubnets: {
    entity: subnetEntity,
    multiple: true,
    required: false,
  },

  /**
   * The peers which are relayed through this peer.
   */
  relayedPeers: {
    entity: peerEntity,
    multiple: true,
    required: false,
  },
})

const sharedPeerOutputs = $outputs({
  peer: peerEntity,
})

export type SharedPeerArgs = z.infer<
  z.ZodObject<{
    // @ts-expect-error idk why
    [K in keyof typeof sharedPeerArgs]: (typeof sharedPeerArgs)[K]["schema"]
  }>
>

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

  args: toPatchArgs(sharedPeerArgs),

  inputs: {
    peer: peerEntity,
    ...sharedPeerInputs,
  },

  outputs: sharedPeerOutputs,

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

  args: sharedPeerArgs,

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
    forwardRestrictedSubnets: z.string().array().default([]),
  },

  inputs: {
    identity: identityEntity,
    k8sCluster: clusterEntity,

    workload: {
      entity: workloadEntity,
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
    workload: {
      entity: workloadEntity,
    },

    interface: {
      entity: networkInterfaceEntity,
    },

    peer: {
      entity: peerEntity,
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

const sharedArgs = $args({
  /**
   * The filter to use when selecting endpoints for each peer.
   *
   * The first matching endpoint will be used.
   *
   * If not provided, all endpoints will be considered.
   */
  peerEndpointFilter: z.string().optional().meta({ language: "javascript" }),
})

/**
 * Just the WireGuard configuration for the identity and peers.
 */
export const config = defineUnit({
  type: "wireguard.config.v1",

  args: {
    ...sharedArgs,

    /**
     * The metadata to include in the wg-feed for this config.
     */
    feedMetadata: z
      .discriminatedUnion("enabled", [
        z.object({
          /**
           * Whether this config is enabled for upload to wg-feed.
           *
           * You must fill the metadata fields.
           */
          enabled: z.literal("true"),

          ...pick(feedMetadataSchema.shape, ["id", "name"]),

          // Highstate does not support nested objects in UI
          ...feedDisplayInfoSchema.shape,
        }),
        z.object({
          /**
           * Whether this config is enabled for upload to wg-feed.
           */
          enabled: z.literal("false"),
        }),
      ])
      .prefault({ enabled: "false" }),
  },

  inputs: {
    identity: identityEntity,
    peers: {
      entity: peerEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    config: configEntity,
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

  args: {
    ...sharedArgs,
  },

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

  outputs: {
    configs: {
      entity: configEntity,
      multiple: true,
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

/**
 * Uploads WireGuard configs to the etcd to be consumed by wg-feed clients.
 */
export const feed = defineUnit({
  type: "wireguard.feed.v1",

  args: {
    /**
     * The TTL seconds to suggest to wg-feed clients.
     *
     * By default, is 900 seconds (15 minutes).
     */
    ttlSeconds: z.number().int().positive().default(900),

    /**
     * The endpoints of the wg-feed servers to use for generating the subscription URLs.
     *
     * At least one endpoint must be provided either here or via `serverEndpoints` input.
     *
     * The resulting subscription URL will be inferred as: `https://{firstEndpoint}/{feedId}#{privateKey}`.
     */
    serverEndpoints: z.string().array().default([]),

    /**
     * The AGE public key (x25519 recipient) to encrypt the configs with.
     *
     * Note: If you provide this, you must provide the corresponding private key to the clients.
     * Resulting subscription URL will not contain the private key.
     */
    publicKey: z.string().optional(),

    /**
     * The display information of the feed.
     */
    displayInfo: feedDisplayInfoSchema,
  },

  secrets: {
    /**
     * The cuidv2 of the feed.
     * Will be used as path of the feed in etcd/subscription URL.
     *
     * In most cases, you don't want to provide this and let it be generated automatically.
     *
     * The `id` field of the feed document will be inferred from this value as `uuidv5(feedId, "2b5e358c-3510-48fb-b1cf-a8aee788925a")`.
     */
    feedId: z.string().optional(),

    /**
     * The AGE private key (x25519 identity) to embed in the subscription URL.
     *
     * If not provided and `publicKey` is not provided, a new key pair will be generated.
     */
    privateKey: z.string().optional(),
  },

  inputs: {
    etcd: etcdEntity,
    serverEndpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
    configs: {
      entity: configEntity,
      multiple: true,
    },
  },

  outputs: {
    endpoint: l7EndpointEntity,
  },

  source: {
    package: "@highstate/wireguard",
    path: "feed",
  },

  meta: {
    title: "WireGuard Feed",
    icon: "simple-icons:wireguard",
    iconColor: "#88171a",
    secondaryIcon: "mdi:rss",
    category: "VPN",
  },
})
