import { databases } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { parseEndpoints } from "../../../shared"

const { args, secrets, inputs, outputs } = forUnit(databases.existingMongodb)

export default outputs({
  mongodb: {
    endpoints: parseEndpoints(args.endpoints, inputs.endpoints, 4),
    username: args.username,
    password: secrets.password,
    database: args.database,
  },
})
