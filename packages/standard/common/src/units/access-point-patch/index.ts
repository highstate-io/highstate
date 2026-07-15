import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { applyBooleanPatch, l3EndpointToString } from "../../shared"
import { patchGateway } from "../gateway-patch/shared"

const { args, inputs, outputs } = forUnit(common.accessPointPatch)

const accessPoint = await toPromise(inputs.accessPoint)
const gateway = await toPromise(inputs.gateway ?? accessPoint.gateway)
const patchedGateway = await patchGateway(gateway, args, inputs)

export default outputs({
  accessPoint: {
    ...accessPoint,
    gateway: patchedGateway,
    tlsIssuers: inputs.tlsIssuers.length > 0 ? inputs.tlsIssuers : accessPoint.tlsIssuers,
    dnsProviders: inputs.dnsProviders.length > 0 ? inputs.dnsProviders : accessPoint.dnsProviders,
    proxied: applyBooleanPatch(accessPoint.proxied, args.proxied),
  },

  $statusFields: {
    endpoints: patchedGateway.endpoints.map(l3EndpointToString),
  },
})
