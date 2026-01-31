import { dns } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { DnsRecordSet, mergeEndpoints, parseEndpoint, replaceEndpointBase } from "../../../shared"

const { name, args, inputs, outputs } = forUnit(dns.recordSet)

const { l3Endpoints, l4Endpoints, l7Endpoints } = await toPromise(inputs)
const waitServers = await toPromise(inputs.waitServers)

new DnsRecordSet("record-set", {
  providers: inputs.dnsProviders,
  name: args.recordName ?? name,
  values: [...args.values, ...l3Endpoints, ...l4Endpoints, ...l7Endpoints],
  waitAt: [...(args.waitLocal ? ["local" as const] : []), ...waitServers],
})

const base = parseEndpoint(args.recordName ?? name)

export default outputs({
  l3Endpoints: mergeEndpoints(l3Endpoints.map(endpoint => replaceEndpointBase(endpoint, base))),
  l4Endpoints: mergeEndpoints(l4Endpoints.map(endpoint => replaceEndpointBase(endpoint, base))),
  l7Endpoints: mergeEndpoints(l7Endpoints.map(endpoint => replaceEndpointBase(endpoint, base))),
})
