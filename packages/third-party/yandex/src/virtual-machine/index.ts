import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseL3Endpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation } from "@highstate/contract"
import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, toPromise } from "@highstate/pulumi"
import { ComputeDisk, ComputeInstance, getVpcSubnet } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(yandex.virtualMachine)

const provider = await createProvider(inputs.connection)

const sshKeyPair =
  inputs.sshKeyPair ?? sshPrivateKeyToKeyPair(getSecret("sshPrivateKey", generateSshPrivateKey))

const rootPassword = getSecret("rootPassword", generatePassword)

// auto-discover subnet if not specified
let subnetId = args.network.subnetId
if (!subnetId) {
  const defaultSubnetName = await toPromise(interpolate`default-${inputs.connection.defaultZone}`)
  const subnet = await getVpcSubnet(
    {
      folderId: await toPromise(inputs.connection.defaultFolderId),
      name: defaultSubnetName,
    },
    { provider },
  )

  if (!subnet.id) {
    throw new Error(
      `Could not find default subnet '${defaultSubnetName}' in zone ${inputs.connection.defaultZone}`,
    )
  }

  subnetId = subnet.id
}

// create the disk
const disk = new ComputeDisk(
  name,
  {
    name: args.vmName ?? name,
    type: args.bootDisk.type,
    size: args.bootDisk.size,
    imageId: inputs.image.id,
    allowRecreate: false,
    folderId: inputs.connection.defaultFolderId,
    zone: inputs.connection.defaultZone,
  },
  { provider, ignoreChanges: ["imageId"] },
)

// create cloud-init user data
const userData = interpolate`
  #cloud-config
  hostname: ${args.vmName ?? name}
  users:
    - name: root
      ssh-authorized-keys:
        - ${sshKeyPair.publicKey}
      sudo: ALL=(ALL) NOPASSWD:ALL
`.apply(trimIndentation)

// create the instance
const instance = new ComputeInstance(
  name,
  {
    name: args.vmName ?? name,
    description: getResourceComment(),
    folderId: inputs.connection.defaultFolderId,
    zone: inputs.connection.defaultZone,
    platformId: args.platformId,

    resources: {
      cores: args.resources.cores,
      memory: args.resources.memory,
      coreFraction: args.resources.coreFraction,
    },

    bootDisk: {
      diskId: disk.id,
    },

    networkInterfaces: [
      {
        subnetId: subnetId,
        nat: args.network.assignPublicIp,
      },
    ],

    metadata: {
      "user-data": userData,
    },
  },
  { provider, ignoreChanges: ["bootDisk"] },
)

// get the IP address
const publicIp = await toPromise(
  instance.networkInterfaces.apply(ni => {
    const firstInterface = ni[0]
    return args.network.assignPublicIp ? firstInterface?.natIpAddress : firstInterface?.ipAddress
  }),
)

if (!publicIp) {
  throw new Error("No IP address assigned to instance")
}

const endpoint = parseL3Endpoint(publicIp)

const { server, terminal } = await createServerBundle({
  name,
  endpoints: [endpoint],
  sshArgs: args.ssh,
  sshPassword: rootPassword,
  sshKeyPair,
})

export default outputs({
  server,
  endpoints: [endpoint],

  $statusFields: {
    id: instance.id,
    endpoints: [l3EndpointToString(endpoint)],
    hostname: server.hostname,
  },

  $terminals: [terminal],
})
