import { network } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { filterWithMetadataByExpression } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.endpointFilter)

const resolvedInputs = await toPromise(inputs)

export default outputs({
  l3Endpoints: filterWithMetadataByExpression(resolvedInputs.l3Endpoints, args.endpointFilter),
  l4Endpoints: filterWithMetadataByExpression(resolvedInputs.l4Endpoints, args.endpointFilter),
  l7Endpoints: filterWithMetadataByExpression(resolvedInputs.l7Endpoints, args.endpointFilter),
})
