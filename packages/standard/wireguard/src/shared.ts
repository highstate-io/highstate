import {
  addressToCidr,
  createAddressSpace,
  filterWithMetadataByExpression,
  type InputAddressSpace,
  l3EndpointToL4,
  l4EndpointToString,
  parseAddress,
  parseEndpoint,
  parseSubnets,
  subnetToString,
} from "@highstate/common"
import { getBestEndpoint } from "@highstate/k8s"
import { type k8s, type network, wireguard } from "@highstate/library"
import { type Input, makeEntity, type Output, secret, type Unwrap } from "@highstate/pulumi"
import { x25519 } from "@noble/curves/ed25519"
import { sha256 } from "@noble/hashes/sha2.js"
import { randomBytes } from "@noble/hashes/utils.js"
import { unique, uniqueBy } from "remeda"

export function generateKey(): string {
  const key = x25519.utils.randomSecretKey()

  return Buffer.from(key).toString("base64")
}

export function convertPrivateKeyToPublicKey(privateKey: string): string {
  const key = Buffer.from(privateKey, "base64")

  return Buffer.from(x25519.getPublicKey(key)).toString("base64")
}

export function generatePresharedKey(): string {
  const key = randomBytes(32)

  return Buffer.from(key).toString("base64")
}

export function combinePresharedKeyParts(part1: string, part2: string): string {
  const key1 = Buffer.from(part1, "base64")
  const key2 = Buffer.from(part2, "base64")

  // combine the two parts in a deterministic order to ensure both sides generate the same key
  const combined = Buffer.concat([key1, key2].toSorted((a, b) => a.compare(b)))

  return Buffer.from(sha256(combined)).toString("base64")
}

function generatePeerConfig(
  identity: wireguard.Identity,
  peer: wireguard.Peer,
  cluster?: k8s.Cluster,
  peerEndpointFilter?: string,
): string {
  const lines = [
    //
    "[Peer]",
    `# ${peer.name}`,
    `PublicKey = ${peer.publicKey}`,
  ]

  const effectiveAllowedSubnets = [...peer.allowedSubnets]

  // add allowed subnets from relayed peers to ensure proper routing through relay nodes
  for (const relayedPeer of peer.relayedPeers) {
    if (relayedPeer.publicKey === identity.peer.publicKey) {
      // skip relayed peer if it's the same as the identity to avoid circular routes
      continue
    }

    effectiveAllowedSubnets.push(...relayedPeer.allowedSubnets)
  }

  const allowedAddressSpace = createAddressSpace({ included: effectiveAllowedSubnets })
  if (allowedAddressSpace.subnets.length > 0) {
    lines.push(`AllowedIPs = ${effectiveAllowedSubnets.map(subnetToString).join(", ")}`)
  }

  let endpoints = peerEndpointFilter
    ? filterWithMetadataByExpression(peer.endpoints, peerEndpointFilter)
    : peer.endpoints

  if (!peer.network?.ipv6) {
    // filter out IPv6 endpoints if the peer's network does not support IPv6 to avoid connectivity issues
    endpoints = endpoints.filter(endpoint => endpoint.type !== "ipv6")
  }

  if (peer.network?.ipv4 === false) {
    // filter out IPv4 endpoints if the peer's network does not support IPv4 to avoid connectivity issues
    endpoints = endpoints.filter(endpoint => endpoint.type !== "ipv4")
  }

  const bestEndpoint = getBestEndpoint(endpoints, cluster)

  if (bestEndpoint) {
    lines.push(`Endpoint = ${l4EndpointToString(bestEndpoint)}`)
  }

  if (peer.persistentKeepalive > 0) {
    lines.push(`PersistentKeepalive = ${peer.persistentKeepalive}`)
  }

  if (identity.peer.presharedKeyPart && peer.presharedKeyPart) {
    const presharedKey = combinePresharedKeyParts(
      identity.peer.presharedKeyPart.value,
      peer.presharedKeyPart.value,
    )

    lines.push(`PresharedKey = ${presharedKey}`)
  } else if (peer.presharedKey || identity.peer.presharedKey) {
    if (peer.presharedKey !== identity.peer.presharedKey) {
      throw new Error(
        `Preshared keys do not match for peers: ${peer.name} and ${identity.peer.name}`,
      )
    }

    lines.push(`PresharedKey = ${peer.presharedKey}`)
  }

  return lines.join("\n")
}

export type IdentityConfigArgs = {
  identity: wireguard.Identity
  peers: wireguard.Peer[]
  listenPort?: number
  dns?: string[]
  postUp?: string[]
  preUp?: string[]
  preDown?: string[]
  postDown?: string[]
  cluster?: k8s.Cluster
  peerEndpointFilter?: string
  listen?: boolean
  network?: wireguard.Network
  table?: number | "off" | "auto"
}

export function generateIdentityConfig({
  identity,
  peers,
  listenPort = identity.peer.listenPort,
  dns = [],
  preUp = [],
  postUp = [],
  preDown = [],
  postDown = [],
  cluster,
  peerEndpointFilter,
  listen = true,
  network,
  table,
}: IdentityConfigArgs): Output<string> {
  const allDns = unique(
    peers
      .flatMap(peer => peer.dns)
      .map(dns => dns.value)
      .concat(dns),
  )

  const lines = [
    //
    "[Interface]",
    `# ${identity.peer.name}`,
  ]

  if (identity.peer.addresses) {
    lines.push(`Address = ${identity.peer.addresses.map(addressToCidr).join(", ")}`)
  }

  if (table) {
    lines.push(`Table = ${table}`)
  }

  lines.push(
    //
    `PrivateKey = ${identity.privateKey.value}`,
    "MTU = 1280",
  )

  if (allDns.length > 0) {
    lines.push(`DNS = ${allDns.join(", ")}`)
  }

  if (listen) {
    lines.push(`ListenPort = ${listenPort}`)
  }

  if (preUp.length > 0) {
    lines.push()
    for (const command of preUp) {
      lines.push(`PreUp = ${command}`)
    }
  }

  if (postUp.length > 0) {
    lines.push()
    for (const command of postUp) {
      lines.push(`PostUp = ${command}`)
    }
  }

  if (preDown.length > 0) {
    lines.push()
    for (const command of preDown) {
      lines.push(`PreDown = ${command}`)
    }
  }

  if (postDown.length > 0) {
    lines.push()
    for (const command of postDown) {
      lines.push(`PostDown = ${command}`)
    }
  }

  if (
    network?.backend === "amneziawg" &&
    network.amnezia &&
    Object.keys(network.amnezia).length > 0
  ) {
    lines.push("")

    for (const [key, value] of Object.entries(network.amnezia)) {
      const firstChar = key.charAt(0).toUpperCase()
      const rest = key.slice(1)
      const parameterName = `${firstChar}${rest}`

      lines.push(`${parameterName} = ${value}`)
    }
  }

  const otherPeers = peers.filter(peer => peer.name !== identity.peer.name)

  for (const peer of otherPeers) {
    lines.push("")
    lines.push(generatePeerConfig(identity, peer, cluster, peerEndpointFilter))
  }

  for (const relayedPeer of identity.peer.relayedPeers) {
    lines.push("")
    lines.push(generatePeerConfig(identity, relayedPeer, cluster, peerEndpointFilter))
  }

  return secret(lines.join("\n"))
}

type SharedPeerInputs = {
  network?: Input<wireguard.Network>
  endpoints: Input<network.L3Endpoint>[]
  allowedSubnets: Input<network.Subnet>[]
  allowedEndpoints: Input<network.L3Endpoint>[]
  relayedPeers: Input<wireguard.Peer>[]
}

export function calculateEndpoints(
  {
    endpoints: argsEnpoints,
    listenPort,
  }: Pick<wireguard.SharedPeerArgs, "endpoints" | "listenPort">,
  { endpoints }: Pick<Unwrap<SharedPeerInputs>, "endpoints">,
): network.L4Endpoint[] {
  return uniqueBy(
    [
      ...endpoints.map(e => l3EndpointToL4(e, e.port ?? listenPort ?? 51820)),
      ...argsEnpoints.map(endpoint => parseEndpoint(endpoint, 4)),
    ],
    endpoint => l4EndpointToString(endpoint),
  )
}

export async function calculateAllowedSubnets(
  {
    includeAddresses,
    excludePrivateSubnets,
    exitNode,
    allowedSubnets,
  }: Pick<
    wireguard.SharedPeerArgs,
    "includeAddresses" | "excludePrivateSubnets" | "exitNode" | "allowedSubnets"
  >,
  { network, allowedSubnets: inputAllowedSubnets }: Unwrap<SharedPeerInputs>,
  addresses: network.Address[],
): Promise<network.Subnet[]> {
  const included: InputAddressSpace[] = await parseSubnets(allowedSubnets, inputAllowedSubnets)
  const excluded: InputAddressSpace[] = []

  if (includeAddresses) {
    included.push(...addresses)
  }

  if (exitNode) {
    if (!network || network?.ipv4) {
      included.push("0.0.0.0/0")
    }

    if (network?.ipv6) {
      included.push("::/0")
    }
  }

  if (excludePrivateSubnets) {
    excluded.push("10.0.0.0/8")
    excluded.push("172.16.0.0/12")
    excluded.push("192.168.0.0/16")

    if (network?.ipv6) {
      excluded.push("fc00::/7")
      excluded.push("fe80::/10")
    }
  }

  const space = createAddressSpace({ included, excluded })
  return space.subnets
}

export function isExitNode(peer: wireguard.Peer): boolean {
  return (
    peer.allowedSubnets.some(subnet => subnetToString(subnet) === "0.0.0.0/0") ||
    peer.allowedSubnets.some(subnet => subnetToString(subnet) === "::/0")
  )
}

export async function createPeerEntity(
  name: string,
  args: wireguard.SharedPeerArgs,
  inputs: Unwrap<SharedPeerInputs>,
  publicKey: string,
  presharedKeyPart?: string,
): Promise<wireguard.Peer> {
  const endpoints = calculateEndpoints(args, inputs)
  const addresses = args.addresses.map(parseAddress)
  const allowedSubnets = await calculateAllowedSubnets(args, inputs, addresses)

  return makeEntity({
    entity: wireguard.peerEntity,
    identity: publicKey,
    meta: {
      title: args.peerName ?? name,
    },
    value: {
      name: args.peerName ?? name,
      endpoints,
      allowedSubnets,
      dns: args.dns.map(parseAddress),
      publicKey,
      addresses,
      network: inputs.network,
      presharedKeyPart,
      listenPort: args.listenPort ?? 51820,
      persistentKeepalive: args.persistentKeepalive,
      feedMetadata: feedMetadataFromArgs(args.feedMetadata),
      relayedPeers: inputs.relayedPeers,
    },
  })
}

export function shouldExpose(
  identity: wireguard.Identity,
  exposePolicy: wireguard.NodeExposePolicy,
): boolean {
  if (exposePolicy === "always") {
    return true
  }

  if (exposePolicy === "never") {
    return false
  }

  return identity.peer.endpoints.length > 0
}

export function feedMetadataFromArgs(
  feedMetadata: wireguard.SharedPeerArgs["feedMetadata"],
): wireguard.FeedMetadata | undefined {
  return feedMetadata.provided === "yes"
    ? {
        id: feedMetadata.id,
        name: feedMetadata.name,
        enabled: feedMetadata.enabled,
        forced: feedMetadata.forced,
        exclusive: feedMetadata.exclusive,
        displayInfo: {
          title: feedMetadata.title,
          description: feedMetadata.description,
          iconUrl: feedMetadata.iconUrl,
        },
      }
    : undefined
}

export function feedMetadataFromPeers(peers: wireguard.Peer[]): wireguard.FeedMetadata | undefined {
  const feedPeers = peers.filter(peer => peer.feedMetadata)

  if (feedPeers.length === 0) {
    return undefined
  }

  if (feedPeers.length > 1) {
    throw new Error("Multiple peers have feed metadata, but only one is allowed")
  }

  return feedPeers[0].feedMetadata
}

export function getNextAvailablePort(portsInUse: number[], startingPort: number = 51820): number {
  let port = startingPort

  while (portsInUse.includes(port)) {
    port++
  }

  return port
}
