import { common } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { map } from "remeda"
import { createServerBundle, l3EndpointToString, requireInputL3Endpoint } from "../../shared"

const { name, args, inputs, secrets, outputs } = forUnit(common.existingServer)

const endpoint = await requireInputL3Endpoint(args.endpoint, inputs.endpoint)

const { server, terminal } = await createServerBundle({
  name,
  endpoints: [endpoint],
  sshArgs: args.ssh,
  sshPassword: secrets.sshPassword,
  sshPrivateKey: secrets.sshPrivateKey,
  sshKeyPair: inputs.sshKeyPair,
})

export default outputs({
  server,
  endpoints: server.endpoints,

  $statusFields: {
    hostname: server.hostname,
    endpoints: server.endpoints.apply(map(l3EndpointToString)),
  },

  $terminals: [terminal],
})
