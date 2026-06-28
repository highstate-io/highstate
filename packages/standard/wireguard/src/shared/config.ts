import type { k8s, wireguard } from "@highstate/library"
import {
  addressToCidr,
  createAddressSpace,
  filterWithMetadataByExpression,
  l4EndpointToString,
  subnetToString,
} from "@highstate/common"
import { getBestEndpoint } from "@highstate/k8s"
import { type Output, secret } from "@highstate/pulumi"
import { unique, uniqueBy } from "remeda"
import { combinePresharedKeyParts } from "./keys"

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

export type ResolvedNodeInputs = {
  identity: wireguard.Identity
  peers: wireguard.Peer[]
}

export function resolveNodeInputs({
  identity,
  config,
  peers = [],
}: {
  identity?: wireguard.Identity
  config?: wireguard.Config
  peers?: wireguard.Peer[]
}): ResolvedNodeInputs {
  if (!!identity === !!config) {
    throw new Error('Exactly one of "identity" or "config" input must be provided.')
  }

  const resolvedIdentity = config?.identity ?? identity

  if (!resolvedIdentity) {
    throw new Error('Failed to resolve identity from "identity" or "config" input.')
  }

  return {
    identity: resolvedIdentity,
    peers: uniqueBy([...(config?.peers ?? []), ...peers], peer => peer.publicKey),
  }
}

export function getNodeConfigContent(config: wireguard.Config): string {
  switch (config.file.content.type) {
    case "embedded": {
      return config.file.content.value
    }
    case "embedded-secret": {
      return config.file.content.value.value
    }
    default: {
      throw new Error(
        `Unsupported config file content type "${config.file.content.type}" for wireguard.node inputs.config. Expected embedded or embedded-secret content.`,
      )
    }
  }
}

export function resolveNodeNetwork(
  identity: wireguard.Identity,
  peers: wireguard.Peer[],
): wireguard.Network | undefined {
  if (identity.peer.network) {
    return identity.peer.network
  }

  return peers.find(peer => peer.network?.backend === "amneziawg")?.network
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
  network = identity.peer.network,
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
