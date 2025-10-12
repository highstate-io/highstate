import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseL3Endpoint } from "../../../shared"

const { args, outputs } = forUnit(network.l3Endpoint)

export default outputs({
  endpoint: parseL3Endpoint(args.endpoint),
})
