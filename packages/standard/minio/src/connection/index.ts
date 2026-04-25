import { parseEndpoints } from "@highstate/common"
import { minio } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(minio.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 7)

export default outputs({
  connection: makeEntityOutput({
    entity: minio.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      endpoints,
      region: args.region,
      credentials: {
        username: args.username,
        password: secrets.password,
      },
    },
  }),
})
