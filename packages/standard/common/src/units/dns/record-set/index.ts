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

const filteredL3Endpoints = filterWithMetadataByExpression(l3Endpoints, args.endpointFilter)
const filteredL4Endpoints = filterWithMetadataByExpression(l4Endpoints, args.endpointFilter)
const filteredL7Endpoints = filterWithMetadataByExpression(l7Endpoints, args.endpointFilter)

new DnsRecordSet("record-set", {
  providers: inputs.dnsProviders,
  name: args.recordName ?? name,
  values: [...args.values, ...filteredL3Endpoints, ...filteredL4Endpoints, ...filteredL7Endpoints],
  waitAt: [...(args.waitLocal ? ["local" as const] : []), ...waitServers],
})

const base = parseEndpoint(args.recordName ?? name)

export default outputs({
  l3Endpoints: mergeEndpoints(filteredL3Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
  l4Endpoints: mergeEndpoints(filteredL4Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
  l7Endpoints: mergeEndpoints(filteredL7Endpoints.map(endpoint => rebaseEndpoint(endpoint, base))),
})
