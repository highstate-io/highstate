import { network } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { addEndpointMetadata, parseEndpoint } from "../../../shared"

const { args, outputs } = forUnit(network.l7Endpoint)

export default outputs({
  endpoint: addEndpointMetadata(parseEndpoint(args.endpoint, 7), args.metadata),
})
