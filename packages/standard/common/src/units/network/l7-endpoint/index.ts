import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoint } from "../../../shared"

const { args, outputs } = forUnit(network.l7Endpoint)

export default outputs({
  endpoint: parseEndpoint(args.endpoint, 7),
})
