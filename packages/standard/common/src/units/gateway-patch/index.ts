import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l3EndpointToString } from "../../shared"
import { patchGateway } from "./shared"

const { args, inputs, outputs } = forUnit(common.gatewayPatch)

const gateway = await toPromise(inputs.gateway)
const patchedGateway = await patchGateway(gateway, args, inputs)

export default outputs({
  gateway: patchedGateway,

  $statusFields: {
    endpoints: patchedGateway.endpoints.map(l3EndpointToString),
  },
})
