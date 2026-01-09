import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { filterEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.endpointFilter)

const resolvedInputs = await toPromise(inputs)

export default outputs({
  l3Endpoints: filterEndpoints(resolvedInputs.l3Endpoints, args.endpointFilter),
  l4Endpoints: filterEndpoints(resolvedInputs.l4Endpoints, args.endpointFilter),
  l7Endpoints: filterEndpoints(resolvedInputs.l7Endpoints, args.endpointFilter),
})
