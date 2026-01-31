import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.mongodbPatch)

const mongodb = await toPromise(inputs.mongodb)
const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : mongodb.endpoints

export default outputs({
  mongodb: {
    ...mongodb,
    endpoints,
    username: args.username ?? mongodb.username,
    database: args.database ?? mongodb.database,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
