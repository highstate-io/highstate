import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.mariadbPatch)

const mariadb = await toPromise(inputs.mariadb)
const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : mariadb.endpoints

export default outputs({
  mariadb: {
    ...mariadb,
    endpoints,
    username: args.username ?? mariadb.username,
    database: args.database ?? mariadb.database,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
