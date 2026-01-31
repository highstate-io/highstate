import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { map } from "remeda"
import { createServerBundle, l3EndpointToString, parseEndpoints } from "../../shared"

const { name, args, inputs, secrets, outputs } = forUnit(common.existingServer)

const endpoints = await parseEndpoints([args.endpoint], inputs.endpoints)

const { server, terminal } = await createServerBundle({
  name,
  endpoints,
  sshArgs: args.ssh,
  sshPassword: secrets.sshPassword,
  sshPrivateKey: secrets.sshPrivateKey,
  sshKeyPair: inputs.sshKeyPair,
})

export default outputs({
  server,

  $statusFields: {
    hostname: server.hostname,
    endpoints: server.endpoints.apply(map(l3EndpointToString)),
  },

  $terminals: [terminal],
})
