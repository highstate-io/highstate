import {
  createAddressSpace,
  type InputAddressSpace,
  l3EndpointToL4,
  l4EndpointToString,
  parseAddress,
  parseEndpoint,
  parseSubnets,
  subnetToString,
} from "@highstate/common"
import { type network, wireguard } from "@highstate/library"
import { type Input, makeEntity, makeSecret, type Unwrap } from "@highstate/pulumi"
import { uniqueBy } from "remeda"
import { feedMetadataFromArgs } from "./feed"

type SharedPeerInputs = {
  network?: Input<wireguard.Network>
  endpoints: Input<network.L3Endpoint>[]
  allowedSubnets: Input<network.Subnet>[]
  allowedEndpoints: Input<network.L3Endpoint>[]
  relayedPeers: Input<wireguard.Peer>[]
}

export function forceUdpEndpoints(endpoints: network.L4Endpoint[]): network.L4Endpoint[] {
  return endpoints.map(endpoint => ({
    ...endpoint,
    protocol: "udp",
  }))
}

export function calculateEndpoints(
  {
    endpoints: argsEnpoints,
    listenPort,
  }: Pick<wireguard.SharedPeerArgs, "endpoints" | "listenPort">,
  { endpoints }: Pick<Unwrap<SharedPeerInputs>, "endpoints">,
): network.L4Endpoint[] {
  return uniqueBy(
    forceUdpEndpoints([
      ...endpoints.map(e => l3EndpointToL4(e, e.port ?? listenPort ?? 51820, "udp")),
      ...argsEnpoints.map(endpoint => parseEndpoint(endpoint, 4)),
    ]),
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
      presharedKeyPart: presharedKeyPart ? makeSecret(presharedKeyPart) : undefined,
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
