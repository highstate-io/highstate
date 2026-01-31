import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.postgresqlPatch)

const postgresql = await toPromise(inputs.postgresql)
const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : postgresql.endpoints

export default outputs({
  postgresql: {
    ...postgresql,
    endpoints,
    username: args.username ?? postgresql.username,
    database: args.database ?? postgresql.database,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
