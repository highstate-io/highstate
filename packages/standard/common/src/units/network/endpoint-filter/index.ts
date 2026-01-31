import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { filterByExpression } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.endpointFilter)

const resolvedInputs = await toPromise(inputs)

export default outputs({
  l3Endpoints: filterByExpression(resolvedInputs.l3Endpoints, args.endpointFilter),
  l4Endpoints: filterByExpression(resolvedInputs.l4Endpoints, args.endpointFilter),
  l7Endpoints: filterByExpression(resolvedInputs.l7Endpoints, args.endpointFilter),
})
