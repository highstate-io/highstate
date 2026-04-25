import { parseEndpoints } from "@highstate/common"
import { mongodb } from "@highstate/library"
import { forUnit, makeEntityOutput, makeSecretOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(mongodb.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 4)

export default outputs({
  connection: makeEntityOutput({
    entity: mongodb.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      endpoints,
      credentials: {
        type: "password",
        username: args.username,
        password: makeSecretOutput(secrets.password),
      },
    },
  }),
})
