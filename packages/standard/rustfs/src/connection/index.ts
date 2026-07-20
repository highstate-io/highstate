import { parseEndpoints } from "@highstate/common"
import { rustfs } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(rustfs.connection)
const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 7)

export default outputs({
  connection: makeEntityOutput({
    entity: rustfs.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      ca: inputs.ca,
      endpoints,
      region: args.region,
      credentials: {
        accessKey: args.accessKey,
        secretKey: secrets.secretKey,
      },
    },
  }),
})
