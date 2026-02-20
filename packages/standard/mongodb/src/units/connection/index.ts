import { parseEndpoints } from "@highstate/common"
import { mongodb } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, secrets, outputs } = forUnit(mongodb.connection)

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
