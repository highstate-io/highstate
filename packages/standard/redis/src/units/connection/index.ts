import { parseEndpoints } from "@highstate/common"
import { redis } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"

const { args, inputs, secrets, outputs } = forUnit(redis.connection)

const endpoints = parseEndpoints(args.endpoints, inputs.endpoints, 4)
const credentials =
  args.username === undefined && secrets.password === undefined
    ? undefined
    : {
        username: args.username,
        password: secrets.password,
      }

export default outputs({
  connection: {
    endpoints,
    credentials,
  },
})
