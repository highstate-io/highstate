import { databases } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { l4EndpointToString, parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.redisPatch)

const redis = await toPromise(inputs.redis)
const resolvedInputEndpoints = await toPromise(inputs.endpoints ?? [])

const shouldOverrideEndpoints =
  args.endpoints.length > 0 || resolvedInputEndpoints.some(endpoint => endpoint != null)
const endpoints = shouldOverrideEndpoints
  ? await parseEndpoints(args.endpoints, inputs.endpoints, 4)
  : redis.endpoints

const redisDatabase = args.database === undefined ? undefined : Number.parseInt(args.database, 10)

if (redisDatabase !== undefined && Number.isNaN(redisDatabase)) {
  throw new Error(`Invalid Redis database number "${args.database}"`)
}

export default outputs({
  redis: {
    ...redis,
    endpoints,
    database: redisDatabase ?? redis.database,
  },

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
