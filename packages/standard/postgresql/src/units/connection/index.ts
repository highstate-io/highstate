import { parseEndpoints } from "@highstate/common"
import { postgresql } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(postgresql.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 4)

export default outputs({
  connection: makeEntityOutput({
    entity: postgresql.connectionEntity,
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
