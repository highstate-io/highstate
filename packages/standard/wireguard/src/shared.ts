import type { k8s, network, wireguard } from "@highstate/library"
import { secret, type Input, type Output, type Unwrap } from "@highstate/pulumi"
import {
  l3EndpointToL4,
  l3EndpointToString,
  l4EndpointToString,
  l34EndpointToString,
  parseL4Endpoint,
  parseL34Endpoint,
} from "@highstate/common"
import { getBestEndpoint } from "@highstate/k8s"
import { x25519 } from "@noble/curves/ed25519"
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
  const result = new Uint8Array(32)

  for (let i = 0; i < 32; i++) {
    result[i] = key1[i] ^ key2[i]
  }

  return Buffer.from(result).toString("base64")
}

function generatePeerConfig(
  identity: wireguard.Identity,
  peer: wireguard.Peer,
  cluster?: k8s.Cluster,
): string {
  const lines = [
    //
    "[Peer]",
    `# ${peer.name}`,
    `PublicKey = ${peer.publicKey}`,
  ]

  if (peer.allowedIps.length > 0) {
    lines.push(`AllowedIPs = ${peer.allowedIps.join(", ")}`)
  }

  const bestEndpoint = getBestEndpoint(peer.endpoints, cluster)

  if (bestEndpoint) {
    lines.push(`Endpoint = ${l4EndpointToString(bestEndpoint)}`)
  }

  if (peer.persistentKeepalive > 0) {
    lines.push(`PersistentKeepalive = ${peer.persistentKeepalive}`)
  }

  if (identity.peer.presharedKeyPart && peer.presharedKeyPart) {
    const presharedKey = combinePresharedKeyParts(
      identity.peer.presharedKeyPart,
      peer.presharedKeyPart,
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
  defaultInterface?: string
  cluster?: k8s.Cluster
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
  defaultInterface,
  cluster,
}: IdentityConfigArgs): Output<string> {
  const allDns = unique(peers.flatMap(peer => peer.dns).concat(dns))
  const excludedIps = unique(peers.flatMap(peer => peer.excludedIps))

  const lines = [
    //
    "[Interface]",
    `# ${identity.peer.name}`,
  ]

  if (identity.peer.address) {
    lines.push(`Address = ${identity.peer.address}`)
  }

  lines.push(
    //
    `PrivateKey = ${identity.privateKey}`,
    "MTU = 1280",
  )

  if (allDns.length > 0) {
    lines.push(`DNS = ${allDns.join(", ")}`)
  }

  if (listenPort) {
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

  if (defaultInterface) {
    lines.push()
    for (const excludedIp of excludedIps) {
      lines.push(`PostUp = ip route add ${excludedIp} dev ${defaultInterface}`)
    }
  }

  const otherPeers = peers.filter(peer => peer.name !== identity.peer.name)

  for (const peer of otherPeers) {
    lines.push("")
    lines.push(generatePeerConfig(identity, peer, cluster))
  }

  return secret(lines.join("\n"))
}

type SharedPeerInputs = {
  network?: Input<wireguard.Network>
  l3Endpoints: Input<network.L3Endpoint>[]
  l4Endpoints: Input<network.L4Endpoint>[]
  allowedL3Endpoints: Input<network.L3Endpoint>[]
  allowedL4Endpoints: Input<network.L4Endpoint>[]
}

export function calculateEndpoints(
  { endpoints, listenPort }: Pick<wireguard.SharedPeerArgs, "endpoints" | "listenPort">,
  { l3Endpoints, l4Endpoints }: Pick<Unwrap<SharedPeerInputs>, "l3Endpoints" | "l4Endpoints">,
): network.L4Endpoint[] {
  return uniqueBy(
    [
      ...l3Endpoints.map(e => l3EndpointToL4(e, listenPort ?? 51820)),
      ...l4Endpoints,
      ...endpoints.map(parseL4Endpoint),
    ],
    endpoint => l4EndpointToString(endpoint),
  )
}

export function calculateAllowedIps(
  { address, exitNode }: Pick<wireguard.SharedPeerArgs, "address" | "exitNode">,
  { network }: Unwrap<SharedPeerInputs>,
  allowedEndpoints: network.L34Endpoint[],
): string[] {
  const result = new Set<string>()

  if (address) {
    result.add(address)
  }

  if (exitNode) {
    result.add("0.0.0.0/0")

    if (network?.ipv6) {
      result.add("::/0")
    }
  }

  for (const endpoint of allowedEndpoints) {
    if (endpoint.type !== "hostname") {
      result.add(l3EndpointToString(endpoint))
    }
  }

  return Array.from(result)
}

export function calculateAllowedEndpoints(
  { allowedEndpoints }: Pick<wireguard.SharedPeerArgs, "allowedEndpoints">,
  {
    allowedL3Endpoints,
    allowedL4Endpoints,
  }: Pick<Unwrap<SharedPeerInputs>, "allowedL3Endpoints" | "allowedL4Endpoints">,
): network.L34Endpoint[] {
  return uniqueBy(
    [
      //
      ...allowedL3Endpoints,
      ...allowedL4Endpoints,
      ...allowedEndpoints.map(parseL34Endpoint),
    ],
    endpoint => l34EndpointToString(endpoint),
  )
}

function calculateExcludedIps(
  { excludedIps, excludePrivateIps }: wireguard.SharedPeerArgs,
  { network }: Unwrap<SharedPeerInputs>,
): string[] {
  const result = new Set<string>()

  for (const ip of excludedIps) {
    result.add(ip)
  }

  if (excludePrivateIps) {
    result.add("10.0.0.0/8")
    result.add("172.16.0.0/12")
    result.add("192.168.0.0/16")

    if (network?.ipv6) {
      result.add("fc00::/7")
      result.add("fe80::/10")
    }
  }

  return Array.from(result)
}

export function isExitNode(peer: wireguard.Peer): boolean {
  return peer.allowedIps.includes("0.0.0.0/0") || peer.allowedIps.includes("::/0")
}

export function createPeerEntity(
  name: string,
  args: wireguard.SharedPeerArgs,
  inputs: Unwrap<SharedPeerInputs>,
  publicKey: string,
  presharedKeyPart?: string,
): wireguard.Peer {
  const endpoints = calculateEndpoints(args, inputs)
  const allowedEndpoints = calculateAllowedEndpoints(args, inputs)
  const allowedIps = calculateAllowedIps(args, inputs, allowedEndpoints)
  const excludedIps = calculateExcludedIps(args, inputs)

  return {
    name: args.peerName ?? name,
    endpoints,
    allowedIps,
    allowedEndpoints,
    excludedIps,
    dns: args.dns,
    publicKey,
    address: args.address,
    network: inputs.network,
    presharedKeyPart,
    listenPort: args.listenPort,
    persistentKeepalive: args.persistentKeepalive,
  }
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
