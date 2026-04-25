import { parseEndpoints } from "@highstate/common"
import { redis } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(redis.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 4)
const credentials =
  args.username === undefined && secrets.password === undefined
    ? undefined
    : {
        username: args.username,
        password: secrets.password,
      }

export default outputs({
  connection: makeEntityOutput({
    entity: redis.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      endpoints,
      credentials,
    },
  }),
})
