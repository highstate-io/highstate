import { databases } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "../../../shared"

const { args, inputs, outputs } = forUnit(databases.existingRedis)

const redisDatabase = args.database === undefined ? undefined : Number.parseInt(args.database, 10)

if (redisDatabase !== undefined && Number.isNaN(redisDatabase)) {
  throw new Error(`Invalid Redis database number "${args.database}"`)
}

export default outputs({
  redis: {
    endpoints: parseEndpoints(args.endpoints, inputs.endpoints, 4),
    database: redisDatabase ?? 0,
  },
})
