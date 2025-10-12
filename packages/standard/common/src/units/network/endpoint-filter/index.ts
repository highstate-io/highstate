import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { filterEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.endpointFilter)

const l3EndpointsResolved = await toPromise(inputs.l3Endpoints)
const l4EndpointsResolved = await toPromise(inputs.l4Endpoints)

export default outputs({
  l3Endpoints: filterEndpoints(l3EndpointsResolved, args.endpointFilter),
  l4Endpoints: filterEndpoints(l4EndpointsResolved, args.endpointFilter),
})
