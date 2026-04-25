import { l4EndpointToString, parseEndpoints } from "@highstate/common"
import { etcd } from "@highstate/library"
import { forUnit, makeEntityOutput, makeSecretOutput, type Output, output } from "@highstate/pulumi"

const { name, stateId, args, inputs, secrets, outputs } = forUnit(etcd.connection)

const endpoints = parseEndpoints([...args.endpoints, ...inputs.endpoints], 4)

let credentials: Output<etcd.Credentials> | undefined

if (args.username && !secrets.password) {
  throw new Error("Password must be provided if username is provided")
}

if (!args.username && secrets.password) {
  throw new Error("Username must be provided if password is provided")
}

if (args.username && secrets.password) {
  credentials = output({
    type: "password",
    username: args.username,
    password: makeSecretOutput(secrets.password),
  })
}

export default outputs({
  connection: makeEntityOutput({
    entity: etcd.connectionEntity,
    identity: stateId,
    meta: {
      title: name,
    },
    value: {
      endpoints: parseEndpoints([...args.endpoints, ...inputs.endpoints], 4),
      credentials,
    },
  }),

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
