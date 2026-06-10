import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation } from "@highstate/contract"
import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, type Output, toPromise } from "@highstate/pulumi"
import { ComputeDisk, ComputeInstance, KmsSymmetricKey, VpcAddress } from "@highstate/yandex-sdk"
import { buildEndpointsFromInstance, detectSubnetId, fetchNetworkContext } from "../network"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(yandex.virtualMachine)

const vmName = args.vmName ?? name

const provider = await createProvider(inputs.connection, args.cloudId)

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const rootPassword = getSecret("rootPassword", generatePassword)

const subnetId = await detectSubnetId(args.network.subnetId, inputs.connection, provider)
const networkContext = await fetchNetworkContext(subnetId, provider)

// create key for disk
let encryptionKeyId: Output<string> | undefined
if (args.bootDisk.encrypted) {
  const encryptionKey = new KmsSymmetricKey(
    "encryption-key",
    {
      name: vmName,
      description: getResourceComment(),
      folderId: args.folderId ?? inputs.connection.defaultFolderId,
    },
    { provider },
  )

  encryptionKeyId = encryptionKey.id
}

// create the disk
const disk = new ComputeDisk(
  "disk",
  {
    name: vmName,
    type: args.bootDisk.type,
    size: args.bootDisk.size,
    imageId: inputs.image.id,
    allowRecreate: false,
    folderId: args.folderId ?? inputs.connection.defaultFolderId,
    zone: inputs.connection.defaultZone,
    kmsKeyId: encryptionKeyId,
  },
  { provider, ignoreChanges: ["imageId"] },
)

// create cloud-init user data
const userData = interpolate`
  #cloud-config
  hostname: ${vmName}
  users:
    - name: root
      ssh-authorized-keys:
        - ${sshKeyPair.publicKey}
      sudo: ALL=(ALL) NOPASSWD:ALL
`.apply(trimIndentation)

let publicAddress: VpcAddress | undefined

if (args.network.assignPublicIp && args.network.reservePublicIp) {
  publicAddress = new VpcAddress(
    "address",
    {
      name: vmName,
      folderId: args.folderId ?? inputs.connection.defaultFolderId,
      description: getResourceComment(),
      externalIpv4Address: {
        zoneId: inputs.connection.defaultZone,
      },
    },
    { provider },
  )
}

// create the instance
const instance = new ComputeInstance(
  "virtual-machine",
  {
    name: vmName,
    description: getResourceComment(),
    folderId: args.folderId ?? inputs.connection.defaultFolderId,
    zone: inputs.connection.defaultZone,
    platformId: args.platformId,
    allowStoppingForUpdate: true,

    resources: {
      cores: args.resources.cores,
      memory: args.resources.memory,
      coreFraction: args.resources.coreFraction,
    },

    schedulingPolicy: {
      preemptible: args.preemptible,
    },

    bootDisk: {
      diskId: disk.id,
    },

    networkInterfaces: [
      {
        subnetId: subnetId,
        nat: args.network.assignPublicIp,
        natIpAddress: publicAddress
          ? publicAddress.externalIpv4Address.apply(a => a!.address)
          : undefined,
      },
    ],

    metadata: {
      "user-data": userData,
    },
  },
  { provider, ignoreChanges: ["bootDisk"] },
)

const resolvedInstance = await toPromise(
  instance.networkInterfaces.apply(networkInterfaces => ({ networkInterfaces })),
)

const endpoints = buildEndpointsFromInstance(
  resolvedInstance,
  args.network.assignPublicIp,
  networkContext,
)

const sshArgs = args.network.assignPublicIp ? args.ssh : { ...(args.ssh ?? {}), enabled: false }

const { server, terminal } = await createServerBundle({
  name: vmName,
  endpoints,
  sshArgs,
  sshPassword: rootPassword,
  sshKeyPair,
})

export default outputs({
  server,

  $statusFields: {
    id: instance.id,
    endpoints: endpoints.map(l3EndpointToString),
    hostname: server.hostname,
  },

  $terminals: [terminal],
})
