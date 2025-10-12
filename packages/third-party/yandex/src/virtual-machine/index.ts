import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseL3Endpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, toPromise } from "@highstate/pulumi"
import { ComputeDisk, ComputeInstance, getComputeImage, getVpcSubnet } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(yandex.virtualMachine)

const provider = await createProvider(inputs.yandexCloud)

const sshKeyPair =
  inputs.sshKeyPair ?? sshPrivateKeyToKeyPair(getSecret("sshPrivateKey", generateSshPrivateKey))

const rootPassword = getSecret("rootPassword", generatePassword)

// get the image
const image = await getComputeImage(
  {
    family: args.disk.imageFamily,
  },
  { provider },
)

// auto-discover subnet if not specified
let subnetId = args.network.subnetId
if (!subnetId) {
  const defaultSubnetName = await toPromise(interpolate`default-${inputs.yandexCloud.defaultZone}`)
  const subnet = await getVpcSubnet(
    {
      folderId: await toPromise(inputs.yandexCloud.defaultFolderId),
      name: defaultSubnetName,
    },
    { provider },
  )

  if (!subnet.id) {
    throw new Error(
      `Could not find default subnet '${defaultSubnetName}' in zone ${inputs.yandexCloud.defaultZone}`,
    )
  }

  subnetId = subnet.id
}

// create the disk
const disk = new ComputeDisk(
  name,
  {
    name: `${name}-disk`,
    type: args.disk.type,
    size: args.disk.size,
    imageId: image.id,
    allowRecreate: false,
    folderId: inputs.yandexCloud.defaultFolderId,
    zone: inputs.yandexCloud.defaultZone,
  },
  { provider, ignoreChanges: ["imageId"] },
)

// create cloud-init user data
const userData = interpolate`#cloud-config
users:
  - name: root
    ssh-authorized-keys:
      - ${sshKeyPair.publicKey}
    sudo: ALL=(ALL) NOPASSWD:ALL
${
  Object.keys(args.metadata).length > 0
    ? `
write_files:
${Object.entries(args.metadata)
  .map(
    ([key, value]) =>
      `  - path: /tmp/${key}
    content: |
      ${value}`,
  )
  .join("\n")}`
    : ""
}
`

// create the instance
const instance = new ComputeInstance(
  name,
  {
    name,
    description: getResourceComment(),
    folderId: inputs.yandexCloud.defaultFolderId,
    zone: inputs.yandexCloud.defaultZone,
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
  sshPrivateKey: sshKeyPair.privateKey,
  sshKeyPair,
})

export default outputs({
  server,
  endpoints: [endpoint],

  $statusFields: {
    endpoints: [l3EndpointToString(endpoint)],
    hostname: server.hostname,
  },

  $terminals: [terminal],
})
