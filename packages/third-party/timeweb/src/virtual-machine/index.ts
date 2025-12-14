import {
  createServerBundle,
  generateSshPrivateKey,
  l3EndpointToString,
  parseL3Endpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { timeweb } from "@highstate/library"
import { forUnit, getResourceComment, toPromise } from "@highstate/pulumi"
import { FloatingIp, SshKey, Server as TimewebServer } from "@highstate/timeweb-sdk"
import { createProvider } from "../provider"

const { name, args, secrets, getSecret, inputs, outputs } = forUnit(timeweb.virtualMachine)

const provider = await createProvider(inputs.connection)

const vmName = args.vmName ?? name
const sshPrivateKey = getSecret("sshPrivateKey", generateSshPrivateKey)
const keyPair = sshPrivateKeyToKeyPair(sshPrivateKey)

const sshKey = new SshKey(
  "ssh-key",
  {
    name: vmName,
    body: keyPair.publicKey,
  },
  { provider },
)

const floatingIp = new FloatingIp(
  "address",
  {
    comment: getResourceComment(),
    availabilityZone: args.availabilityZone,
    ddosGuard: false,
  },
  { provider },
)

new TimewebServer(
  "virtual-machine",
  {
    name: vmName,
    comment: getResourceComment(),
    availabilityZone: args.availabilityZone,
    floatingIpId: floatingIp.id,
    presetId: args.presetId,
    osId: args.osId,
    isRootPasswordRequired: false,
    sshKeysIds: [sshKey.sshKeyId.apply(Number)],
  },
  { provider },
)

const serverIp = await toPromise(floatingIp.ip)
const endpoint = parseL3Endpoint(serverIp)

const { server, terminal } = await createServerBundle({
  name: vmName,
  endpoints: [endpoint],
  sshArgs: args.ssh,
  sshPrivateKey,
  sshPassword: secrets.rootPassword,
})

export default outputs({
  server,
  endpoints: [endpoint],

  $statusFields: {
    hostname: {
      value: server.hostname,
    },
    endpoints: {
      value: [l3EndpointToString(endpoint)],
    },
  },

  $terminals: [terminal],
})
