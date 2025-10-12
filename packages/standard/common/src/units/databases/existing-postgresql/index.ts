import { databases } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "../../../shared"

const { args, secrets, inputs, outputs } = forUnit(databases.existingPostgresql)

export default outputs({
  postgresql: {
    endpoints: parseEndpoints(args.endpoints, inputs.endpoints),
    username: args.username,
    password: secrets.password,
    database: args.database,
  },
})
