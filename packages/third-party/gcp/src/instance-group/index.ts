import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation, type UnitTerminal } from "@highstate/contract"
import { gcp } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, toPromise } from "@highstate/pulumi"
import * as gcpProvider from "@pulumi/gcp"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(gcp.instanceGroup)

const groupName = args.groupName ?? name
const region = args.region ?? inputs.connection.defaultRegion

const zone =
  args.zone ??
  inputs.connection.defaultZone ??
  (
    await gcpProvider.compute.getZones(
      {
        region,
        project: args.projectId ?? inputs.connection.projectId,
        status: "UP",
      },
      {
        provider: await createProvider(inputs.connection, args.projectId, region),
      },
    )
  ).names[0]

if (!zone) {
  throw new Error(`Could not determine an available zone for region "${region}"`)
}

const provider = await createProvider(inputs.connection, args.projectId, region, zone)

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const rootPassword = getSecret("rootPassword", generatePassword)

const userData = interpolate`
  #cloud-config
  users:
    - name: root
      ssh-authorized-keys:
        - ${sshKeyPair.publicKey}
      sudo: ALL=(ALL) NOPASSWD:ALL
  chpasswd:
    list: |
      root:${rootPassword}
    expire: false
`.apply(trimIndentation)

let kmsKey: gcpProvider.kms.CryptoKey | undefined
if (args.bootDisk.encrypted) {
  const keyRing = new gcpProvider.kms.KeyRing(
    "boot-key-ring",
    {
      name: `${groupName}-boot`,
      location: region,
    },
    { provider },
  )

  kmsKey = new gcpProvider.kms.CryptoKey(
    "boot-key",
    {
      name: `${groupName}-boot`,
      keyRing: keyRing.id,
    },
    { provider },
  )
}

const subnetwork =
  args.network.subnetworkId ??
  (
    await gcpProvider.compute.getSubnetwork(
      {
        name: "default",
        region,
        project: args.projectId ?? inputs.connection.projectId,
      },
      { provider },
    )
  ).selfLink

const instanceTemplate = new gcpProvider.compute.InstanceTemplate(
  "instance-template",
  {
    namePrefix: `${groupName}-template-`,
    description: getResourceComment(),
    machineType: args.machineType,

    disks: [
      {
        boot: true,
        autoDelete: false,
        deviceName: "boot-disk",
        sourceImage: inputs.image.id,
        diskType: args.bootDisk.type,
        diskSizeGb: args.bootDisk.size,
        diskEncryptionKey: kmsKey ? { kmsKeySelfLink: kmsKey.id } : undefined,
      },
    ],

    scheduling: {
      preemptible: args.preemptible,
      automaticRestart: !args.preemptible,
    },

    networkInterfaces: [
      {
        subnetwork,
        accessConfigs: args.network.assignPublicIp ? [{}] : [],
      },
    ],

    metadata: {
      "user-data": userData,
    },
  },
  { provider },
)

const diskResources = Array.from({ length: args.size }, (_, i) => {
  const index = i + 1

  return new gcpProvider.compute.Disk(
    `disk-${index}`,
    {
      name: `${groupName}-${index}`,
      zone,
      type: args.bootDisk.type,
      size: args.bootDisk.size,
      image: inputs.image.id,
      diskEncryptionKey: kmsKey ? { kmsKeySelfLink: kmsKey.id } : undefined,
      description: getResourceComment(),
    },
    { provider },
  )
})

const internalAddresses = Array.from({ length: args.size }, (_, i) => {
  const index = i + 1

  return new gcpProvider.compute.Address(
    `internal-address-${index}`,
    {
      name: `${groupName}-internal-${index}`,
      addressType: "INTERNAL",
      subnetwork,
      region,
      description: getResourceComment(),
    },
    { provider },
  )
})

const publicAddresses =
  args.network.assignPublicIp && args.network.reservePublicIp
    ? Array.from({ length: args.size }, (_, i) => {
        const index = i + 1

        return new gcpProvider.compute.Address(
          `address-${index}`,
          {
            name: `${groupName}-${index}`,
            addressType: "EXTERNAL",
            region,
            description: getResourceComment(),
          },
          { provider },
        )
      })
    : []

const instanceGroupManager = new gcpProvider.compute.InstanceGroupManager(
  "instance-group",
  {
    name: groupName,
    description: getResourceComment(),
    zone,
    baseInstanceName: groupName,
    targetSize: args.size,

    versions: [
      {
        name: "primary",
        instanceTemplate: instanceTemplate.selfLink,
      },
    ],

    updatePolicy: {
      type: "PROACTIVE",
      minimalAction: "REPLACE",
      replacementMethod: "RECREATE",
      maxSurgeFixed: 0,
      maxUnavailableFixed: 1,
    },

    statefulDisks: [
      {
        deviceName: "boot-disk",
        deleteRule: "NEVER",
      },
    ],

    statefulInternalIps: [
      {
        interfaceName: "nic0",
        deleteRule: "NEVER",
      },
    ],

    statefulExternalIps:
      args.network.assignPublicIp && args.network.reservePublicIp
        ? [
            {
              interfaceName: "nic0",
              deleteRule: "NEVER",
            },
          ]
        : undefined,

    waitForInstances: true,
    waitForInstancesStatus: "UPDATED",
  },
  { provider },
)

const perInstanceConfigs = Array.from({ length: args.size }, (_, i) => {
  const index = i + 1
  const instanceName = `${groupName}-${index}`

  return new gcpProvider.compute.PerInstanceConfig(
    `per-instance-config-${index}`,
    {
      zone,
      instanceGroupManager: instanceGroupManager.name,
      name: instanceName,
      minimalAction: "REPLACE",
      mostDisruptiveAllowedAction: "REPLACE",

      preservedState: {
        disks: [
          {
            deviceName: "boot-disk",
            source: diskResources[i].id,
            mode: "READ_WRITE",
            deleteRule: "NEVER",
          },
        ],
        internalIps: [
          {
            interfaceName: "nic0",
            autoDelete: "NEVER",
            ipAddress: {
              address: internalAddresses[i].selfLink,
            },
          },
        ],
        externalIps:
          args.network.assignPublicIp && args.network.reservePublicIp
            ? [
                {
                  interfaceName: "nic0",
                  autoDelete: "NEVER",
                  ipAddress: {
                    address: publicAddresses[i].selfLink,
                  },
                },
              ]
            : undefined,
      },
    },
    { provider },
  )
})

await Promise.all(perInstanceConfigs.map(config => toPromise(config.id)))
await toPromise(instanceGroupManager.id)

const serverBundles = await Promise.all(
  Array.from({ length: args.size }, async (_, i) => {
    const instanceName = `${groupName}-${i + 1}`

    const instance = await gcpProvider.compute.getInstance(
      {
        name: instanceName,
        zone,
        project: args.projectId ?? inputs.connection.projectId,
      },
      { provider },
    )

    const firstInterface = instance.networkInterfaces[0]
    const accessConfig = firstInterface?.accessConfigs?.[0]

    const address = args.network.assignPublicIp ? accessConfig?.natIp : firstInterface?.networkIp

    if (!address) {
      throw new Error(`No IP address assigned to instance "${instanceName}"`)
    }

    const endpoint = parseEndpoint(address, 3)

    return await createServerBundle({
      name: instanceName,
      endpoints: [endpoint],
      sshArgs: args.ssh,
      sshPassword: rootPassword,
      sshKeyPair,
    })
  }),
)

const terminals: UnitTerminal[] = []

for (const [index, bundle] of serverBundles.entries()) {
  if (bundle.terminal) {
    const rawTerminal = await toPromise(bundle.terminal)

    terminals.push({
      ...rawTerminal,
      name: `ssh-${index + 1}`,
      meta: {
        title: `Shell (${index + 1})`,
      },
    })
  }
}

const servers = serverBundles.map(bundle => bundle.server)

export default outputs({
  servers,

  $statusFields: {
    id: instanceGroupManager.id,
    endpoints: servers.flatMap(server => server.endpoints).map(l3EndpointToString),
  },

  $terminals: terminals,
})
