import {
  l3EndpointToL4,
  l4EndpointToString,
  parseAddress,
  parseEndpoint,
  parseSubnet,
} from "@highstate/common"
import { mullvad } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"
import { map } from "remeda"
import { ServerList } from "./server-list"

const { name, args, inputs, outputs } = forUnit(mullvad.peer)

const network = await toPromise(inputs.network)

const hostname = args.hostname ?? name
const serverList = new ServerList("servers", { now: Date.now() })

const server = serverList.servers.apply(servers => {
  const server = servers.find(server => server.hostname === hostname)
  if (!server) {
    throw new Error(`Server not found: ${args.hostname}`)
  }

  if (server.type !== "wireguard") {
    throw new Error(`Server is not a WireGuard server: ${args.hostname}`)
  }

  return server
})

const endpoints = output([server.fqdn, server.ipv4_addr_in, server.ipv6_addr_in])
  .apply(map(endpoint => parseEndpoint(endpoint)))
  .apply(map(endpoint => l3EndpointToL4(endpoint, 51820, "udp")))

const dns = args.includeDns ? [parseAddress("10.64.0.1")] : []
const allowedIps = ["0.0.0.0/0", ...dns]

if (network?.ipv6) {
  allowedIps.push("::0/0")
}

export default outputs({
  peer: {
    name,
    publicKey: server.pubkey,
    addresses: [],
    endpoints,
    allowedSubnets: allowedIps.map(parseSubnet),
    dns,
  },

  endpoints,

  $statusFields: {
    publicKey: server.pubkey,
    endpoints: endpoints.apply(map(l4EndpointToString)),
  },
})
