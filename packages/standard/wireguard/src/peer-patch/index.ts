import { l4EndpointToString, parseEndpoints, parseSubnets, subnetToString } from "@highstate/common"
import { wireguard } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(wireguard.peerPatch)

const peer = await toPromise(inputs.peer)
const endpoints = await parseEndpoints(args.endpoints, inputs.endpoints, 4)
const allowedSubnets = await parseSubnets(args.allowedSubnets, inputs.allowedSubnets)

const newEndpoints = endpoints.length > 0 ? endpoints : peer.endpoints
const newAllowedSubnets = allowedSubnets.length > 0 ? allowedSubnets : peer.allowedSubnets

export default outputs({
  peer: inputs.peer.apply(peer => ({
    ...peer,
    endpoints: newEndpoints,
    allowedSubnets: newAllowedSubnets,
  })),

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
    allowedSubnets: allowedSubnets.map(subnetToString),
  },
})
