import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation } from "@highstate/contract"
import { gcp } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, toPromise } from "@highstate/pulumi"
import * as gcpProvider from "@pulumi/gcp"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(gcp.virtualMachine)

const vmName = args.vmName ?? name
const region = args.region ?? inputs.connection.defaultRegion

const provider = await createProvider(inputs.connection, args.projectId, region)

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
      { provider },
    )
  ).names[0]

if (!zone) {
  throw new Error(`Could not determine an available zone for region "${region}"`)
}

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const rootPassword = getSecret("rootPassword", generatePassword)

let kmsKey: gcpProvider.kms.CryptoKey | undefined
if (args.bootDisk.encrypted) {
  const keyRing = new gcpProvider.kms.KeyRing(
    "boot-key-ring",
    {
      name: `${vmName}-boot`,
      location: region,
    },
    { provider },
  )

  kmsKey = new gcpProvider.kms.CryptoKey(
    "boot-key",
    {
      name: `${vmName}-boot`,
      keyRing: keyRing.id,
    },
    { provider },
  )
}

let publicAddress: gcpProvider.compute.Address | undefined
if (args.network.assignPublicIp && args.network.reservePublicIp) {
  publicAddress = new gcpProvider.compute.Address(
    "address",
    {
      name: vmName,
      addressType: "EXTERNAL",
      region,
      description: getResourceComment(),
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

const instance = new gcpProvider.compute.Instance(
  "virtual-machine",
  {
    name: vmName,
    description: getResourceComment(),
    zone,
    machineType: args.machineType,
    allowStoppingForUpdate: true,

    bootDisk: {
      initializeParams: {
        image: inputs.image.id,
        type: args.bootDisk.type,
        size: args.bootDisk.size,
      },
      kmsKeySelfLink: kmsKey?.id,
      autoDelete: true,
    },

    scheduling: {
      preemptible: args.preemptible,
      automaticRestart: !args.preemptible,
    },

    networkInterfaces: [
      {
        subnetwork,
        accessConfigs: args.network.assignPublicIp
          ? [
              {
                natIp: publicAddress?.address,
              },
            ]
          : [],
      },
    ],

    metadata: {
      "user-data": userData,
    },
  },
  { provider },
)

const addresses = await toPromise(
  instance.networkInterfaces.apply(
    (interfaces: gcpProvider.types.output.compute.InstanceNetworkInterface[]) => {
      const firstInterface = interfaces[0]
      const accessConfig = firstInterface?.accessConfigs?.[0]

      if (!firstInterface?.networkIp) {
        throw new Error("No private IP address assigned to instance")
      }

      return {
        privateIp: firstInterface.networkIp,
        publicIp: args.network.assignPublicIp ? accessConfig?.natIp : undefined,
      }
    },
  ),
)

if (args.network.assignPublicIp && !addresses.publicIp) {
  throw new Error("No public IP address assigned to instance")
}

const endpoints = [addresses.publicIp, addresses.privateIp]
  .filter(address => address !== undefined)
  .map(address => parseEndpoint(address, 3))

const { server, terminal } = await createServerBundle({
  name: vmName,
  endpoints,
  sshArgs: args.ssh,
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
