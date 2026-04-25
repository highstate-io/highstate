import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { filterByExpression, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(network.l3EndpointReplacer)

const endpoints = parseEndpoints(
  [
    ...(args.includeCurrent ? inputs.entity.endpoints : []),
    ...args.endpoints,
    ...inputs.endpoints,
    ...inputs.addresses,
  ],
  3,
)

export default outputs({
  entity: {
    ...inputs.entity,
    endpoints: filterByExpression(endpoints, args.endpointFilter),
  },
})
