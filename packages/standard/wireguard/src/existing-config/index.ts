import { parseAddress, parseEndpoint, parseSubnet } from "@highstate/common"
import { common, type network as networkLibrary, wireguard } from "@highstate/library"
import { forUnit, makeEntity, makeSecret } from "@highstate/pulumi"
import { convertPrivateKeyToPublicKey } from "../shared"
import { parseExistingConfig } from "./parser"

const { name, stateId, args, outputs } = forUnit(wireguard.existingConfig)

function parseEndpointValue(endpoint: string): networkLibrary.L4Endpoint {
  return parseEndpoint(`udp://${endpoint}`, 4)
}

const parsedConfig = parseExistingConfig(args.config)
const wireguardNetwork = makeEntity({
  entity: wireguard.networkEntity,
  identity: `${stateId}:network`,
  meta: {
    title: `${name} network`,
  },
  value: {
    backend: Object.keys(parsedConfig.interface.amnezia).length > 0 ? "amneziawg" : "wireguard",
    ipv4: true,
    ipv6: false,
    amnezia: parsedConfig.interface.amnezia,
  },
})

const privateKey = parsedConfig.interface.privateKey
const identityPublicKey = convertPrivateKeyToPublicKey(privateKey)
const identityAddresses = parsedConfig.interface.addresses.map(parseAddress)
const identityPeer = makeEntity({
  entity: wireguard.peerEntity,
  identity: identityPublicKey,
  meta: {
    title: parsedConfig.interface.name ?? name,
  },
  value: {
    name: parsedConfig.interface.name ?? name,
    publicKey: identityPublicKey,
    addresses: identityAddresses,
    dns: parsedConfig.interface.dns.map(parseAddress),
    allowedSubnets: identityAddresses.map(address => address.asSubnet),
    endpoints: [],
    relayedPeers: [],
    network: wireguardNetwork,
    listenPort: parsedConfig.interface.listenPort,
    persistentKeepalive: 0,
  },
})

const identity = makeEntity({
  entity: wireguard.identityEntity,
  identity: identityPublicKey,
  meta: {
    title: identityPeer.name,
  },
  value: {
    peer: identityPeer,
    privateKey: makeSecret(privateKey),
  },
})

const peers = parsedConfig.peers.map((peer, index) => {
  const peerName = peer.name ?? `${name}.peer-${index + 1}`

  return makeEntity({
    entity: wireguard.peerEntity,
    identity: peer.publicKey,
    meta: {
      title: peerName,
    },
    value: {
      name: peerName,
      publicKey: peer.publicKey,
      presharedKey: peer.presharedKey ? makeSecret(peer.presharedKey) : undefined,
      addresses: [],
      dns: [],
      allowedSubnets: peer.allowedIps.map(parseSubnet),
      endpoints: peer.endpoint ? [parseEndpointValue(peer.endpoint)] : [],
      relayedPeers: [],
      network: wireguardNetwork,
      listenPort: 51820,
      persistentKeepalive: peer.persistentKeepalive,
    },
  })
})

const file = makeEntity({
  entity: common.fileEntity,
  identity: stateId,
  meta: {
    title: `${name}.conf`,
  },
  value: {
    meta: {
      name: `${name}.conf`,
    },
    content: {
      type: "embedded-secret",
      value: makeSecret(args.config),
    },
  },
})

export default outputs({
  config: makeEntity({
    entity: wireguard.configEntity,
    identity: stateId,
    meta: {
      title: identity.peer.name,
    },
    value: {
      file,
      identity,
      peers,
    },
  }),
  identity,
  network: wireguardNetwork,
  peers,
})
