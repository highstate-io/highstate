import { l3EndpointToString, l4EndpointToString, updateEndpoints } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { calculateAllowedEndpoints, calculateAllowedIps, calculateEndpoints } from "../shared"

const { args, inputs, outputs } = forUnit(wireguard.peerPatch)

const resolvedInputs = await toPromise(inputs)

const endpoints = await updateEndpoints(
  inputs.peer.endpoints,
  [],
  calculateEndpoints({ ...args, listenPort: resolvedInputs.peer.listenPort }, resolvedInputs),
  args.endpointsPatchMode,
)

const allowedEndpoints = await updateEndpoints(
  inputs.peer.allowedEndpoints,
  [],
  calculateAllowedEndpoints(args, resolvedInputs),
  args.allowedEndpointsPatchMode,
)

export default outputs({
  peer: {
    ...resolvedInputs.peer,
    endpoints,
    allowedEndpoints,
    dns: args.dns.length > 0 ? args.dns : resolvedInputs.peer.dns,
    allowedIps: calculateAllowedIps(
      { address: args.address ?? resolvedInputs.peer.address, exitNode: args.exitNode },
      resolvedInputs,
      allowedEndpoints,
    ),
  },

  endpoints,

  $statusFields: {
    endpoints: {
      value: endpoints.map(l4EndpointToString),
      complementaryTo: "endpoints",
    },
    allowedEndpoints: {
      value: allowedEndpoints.map(l3EndpointToString),
      complementaryTo: "allowedEndpoints",
    },
  },
})
