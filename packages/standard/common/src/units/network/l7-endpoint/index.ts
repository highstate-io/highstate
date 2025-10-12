import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseL7Endpoint } from "../../../shared"

const { args, outputs } = forUnit(network.l7Endpoint)

export default outputs({
  endpoint: parseL7Endpoint(args.endpoint),
})
