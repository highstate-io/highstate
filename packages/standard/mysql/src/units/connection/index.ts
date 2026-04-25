import { parseEndpoints } from "@highstate/common"
import { mysql } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(mysql.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 4)

export default outputs({
  connection: makeEntityOutput({
    entity: mysql.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      endpoints,
      credentials: {
        type: "password",
        username: args.username,
        password: secrets.password,
      },
    },
  }),
})
