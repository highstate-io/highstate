import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { l3EndpointToString, updateEndpointsWithFqdn } from "../../shared"

const { args, inputs, outputs } = forUnit(common.serverDns)

const { endpoints } = await updateEndpointsWithFqdn(
  inputs.server.endpoints,
  args.fqdn,
  args.endpointFilter,
  args.patchMode,
  inputs.dnsProviders,
)

export default outputs({
  server: inputs.server.apply(server => ({
    ...server,
    endpoints,
  })),

  endpoints,

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
  },
})
