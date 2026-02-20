import { parseEndpoints } from "@highstate/common"
import { postgresql } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, secrets, outputs } = forUnit(postgresql.connection)

const endpoints = parseEndpoints(args.endpoints, inputs.endpoints, 4)

export default outputs({
  connection: {
    endpoints,
    credentials: {
      username: args.username,
      password: secrets.password,
    },
  },
})
