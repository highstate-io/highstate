import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { l3EndpointToString, updateEndpoints } from "../../shared"

const { args, inputs, outputs } = forUnit(common.serverPatch)

const endpoints = await updateEndpoints(
  inputs.server.endpoints,
  args.endpoints,
  inputs.endpoints,
  args.endpointsPatchMode,
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
