import { common } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l3EndpointToString, parseEndpoints } from "../../shared"

const { args, inputs, outputs } = forUnit(common.serverPatch)

const server = await toPromise(inputs.server)
const endpoints = await parseEndpoints(args.endpoints, inputs.endpoints, 3)

const newEndpoints = endpoints.length > 0 ? endpoints : server.endpoints

export default outputs({
  server: {
    ...server,
    hostname: args.hostname ?? server.hostname,
    endpoints: newEndpoints,
  },

  $statusFields: {
    endpoints: endpoints.map(l3EndpointToString),
  },
})
