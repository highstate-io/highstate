import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation, type UnitTerminal } from "@highstate/contract"
import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, type Output, toPromise } from "@highstate/pulumi"
import {
  ComputeDisk,
  ComputeInstanceGroup,
  getVpcSubnet,
  KmsSymmetricKey,
  VpcAddress,
} from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(yandex.instanceGroup)

const groupName = args.groupName ?? name

const provider = await createProvider(inputs.connection, args.cloudId)

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

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

// create single key for all disks in the group
let encryptionKeyId: Output<string> | undefined
if (args.bootDisk.encrypted) {
  const encryptionKey = new KmsSymmetricKey(
    "encryption-key",
    {
      name: groupName,
      description: getResourceComment(),
      folderId: args.folderId ?? inputs.connection.defaultFolderId,
    },
    { provider },
  )

  encryptionKeyId = encryptionKey.id
}

// create the disk for each instance in the group
const disks = Array.from({ length: args.size }, (_, i) => {
  return new ComputeDisk(
    `disk-${i + 1}`,
    {
      name: `${groupName}-${i + 1}`,
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
})

// create internal IPs for each instance in the group
const internalAddresses = Array.from({ length: args.size }, (_, i) => {
  return new VpcAddress(
    `internal-address-${i + 1}`,
    {
      name: `${groupName}-internal-${i + 1}`,
      folderId: args.folderId ?? inputs.connection.defaultFolderId,
      description: getResourceComment(),
      internalIpv4Address: {
        subnetId,
      },
    },
    { provider },
  )
})

// create public IPs if needed
let publicAddresses: VpcAddress[] | undefined

if (args.network.assignPublicIp && args.network.reservePublicIp) {
  publicAddresses = Array.from({ length: args.size }, (_, i) => {
    return new VpcAddress(
      `address-${i + 1}`,
      {
        name: `${groupName}-${i + 1}`,
        folderId: args.folderId ?? inputs.connection.defaultFolderId,
        description: getResourceComment(),
        externalIpv4Address: {
          zoneId: inputs.connection.defaultZone,
        },
      },
      { provider },
    )
  })
}

// create cloud-init user data
const userData = interpolate`
  #cloud-config
  hostname: ${groupName}-{instance.index}
  users:
    - name: root
      ssh-authorized-keys:
        - ${sshKeyPair.publicKey}
      sudo: ALL=(ALL) NOPASSWD:ALL
`.apply(trimIndentation)

const instanceGroup = new ComputeInstanceGroup(
  "instance-group",
  {
    name: groupName,
    description: getResourceComment(),
    folderId: args.folderId ?? inputs.connection.defaultFolderId,

    allocationPolicy: {
      zones: [inputs.connection.defaultZone],
    },

    deployPolicy: {
      maxExpansion: 0,
      maxUnavailable: 1,
    },

    scalePolicy: {
      fixedScale: {
        size: args.size,
      },
    },

    instanceTemplate: {
      name: `${groupName}-{instance.index}`,
      description: getResourceComment(),
      platformId: args.platformId,

      resources: {
        cores: args.resources.cores,
        memory: args.resources.memory,
        coreFraction: args.resources.coreFraction,
      },

      schedulingPolicy: {
        preemptible: args.preemptible,
      },

      bootDisk: {
        diskId: `{disk_{instance.index}}`,
      },

      networkInterfaces: [
        {
          subnetIds: [subnetId],
          ipAddress: `{internal_address_{instance.index}}`,
          nat: args.network.assignPublicIp,
          natIpAddress: publicAddresses ? `{address_{instance.index}}` : undefined,
        },
      ],

      metadata: {
        "user-data": userData,
      },
    },

    variables: {
      ...Object.fromEntries(disks.map((_, i) => [`disk_${i + 1}`, disks[i].id])),
      ...Object.fromEntries(
        internalAddresses.map((_, i) => [
          `internal_address_${i + 1}`,
          internalAddresses[i].internalIpv4Address.apply(a => a!.address),
        ]),
      ),
      ...(publicAddresses
        ? Object.fromEntries(
            publicAddresses.map((_, i) => [
              `address_${i + 1}`,
              publicAddresses[i].externalIpv4Address.apply(a => a!.address),
            ]),
          )
        : {}),
    },

    serviceAccountId: inputs.connection.serviceAccountId,
  },
  { provider },
)

const terminals: UnitTerminal[] = []
const instances = await toPromise(instanceGroup.instances)

const servers = await toPromise(
  instances.map(async (instance, i) => {
    // get the IP address
    const firstInterface = instance.networkInterfaces[0]
    const publicIp = args.network.assignPublicIp
      ? firstInterface?.natIpAddress
      : firstInterface?.ipAddress

    if (!publicIp) {
      throw new Error("No IP address assigned to instance")
    }

    const endpoint = parseEndpoint(publicIp, 3)

    const { server, terminal } = await createServerBundle({
      name: `${groupName}-${i + 1}`,
      endpoints: [endpoint],
      sshArgs: args.ssh,
      sshPassword: rootPassword,
      sshKeyPair,
    })

    if (terminal) {
      const rawTerminal = await toPromise(terminal)

      terminals.push({
        ...rawTerminal,
        name: `ssh-${i + 1}`,
        meta: {
          title: `Shell (${i + 1})`,
        },
      })
    }

    return server
  }),
)

export default outputs({
  servers,

  $statusFields: {
    id: instanceGroup.id,
    endpoints: servers.flatMap(server => server.endpoints).map(l3EndpointToString),
  },

  $terminals: terminals,
})
