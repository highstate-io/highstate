import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { filterByExpression } from "../shared"

const { args, inputs, outputs } = forUnit(common.filter)

export default outputs({
  entities: filterByExpression(inputs.entities, args.expression),
})
