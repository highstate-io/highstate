import { dns } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import {
  DnsRecordSet,
  filterWithMetadataByExpression,
  mergeEndpoints,
  parseEndpoint,
  rebaseEndpoint,
} from "../../../shared"

const { name, args, inputs, outputs } = forUnit(dns.recordSet)

const { l3Endpoints, l4Endpoints, l7Endpoints } = await toPromise(inputs)
const waitServers = await toPromise(inputs.waitServers)

const allL3Endpoints = [...args.values, ...l3Endpoints]
  .map(endpoint => parseEndpoint(endpoint))
  .filter(endpoint => endpoint.level === 3)

const allL4Endpoints = [...args.values, ...l4Endpoints]
  .map(endpoint => parseEndpoint(endpoint))
  .filter(endpoint => endpoint.level === 4)

const allL7Endpoints = [...args.values, ...l7Endpoints]
  .map(endpoint => parseEndpoint(endpoint))
  .filter(endpoint => endpoint.level === 7)

const filteredL3Endpoints = filterWithMetadataByExpression(allL3Endpoints, args.endpointFilter)
const filteredL4Endpoints = filterWithMetadataByExpression(allL4Endpoints, args.endpointFilter)
const filteredL7Endpoints = filterWithMetadataByExpression(allL7Endpoints, args.endpointFilter)

new DnsRecordSet("record-set", {
  providers: inputs.dnsProviders,
  name: args.recordName ?? name,
  values: [...filteredL3Endpoints, ...filteredL4Endpoints, ...filteredL7Endpoints],
  waitAt: [...(args.waitLocal ? ["local" as const] : []), ...waitServers],
  proxied: args.proxied,
})

const base = parseEndpoint(args.recordName ?? name)

export default outputs({
  l3Endpoints: mergeEndpoints(filteredL3Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
  l4Endpoints: mergeEndpoints(filteredL4Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
  l7Endpoints: mergeEndpoints(filteredL7Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
})
