import { mysql } from "@highstate/library"
import { parseEndpoints } from "@highstate/common"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, secrets, outputs } = forUnit(mysql.connection)

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
