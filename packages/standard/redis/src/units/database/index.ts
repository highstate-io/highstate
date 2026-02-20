import { redis } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, outputs } = forUnit(redis.database)

export default outputs({
  database: {
    database: args.database,
    endpoints: inputs.connection.endpoints,
    credentials: inputs.connection.credentials,
  },
})
