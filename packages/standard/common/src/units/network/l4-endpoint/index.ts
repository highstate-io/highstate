import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseL4Endpoint } from "../../../shared"

const { args, outputs } = forUnit(network.l4Endpoint)

export default outputs({
  endpoint: parseL4Endpoint(args.endpoint),
})
