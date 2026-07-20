import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  l4EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation, type UnitTerminal } from "@highstate/contract"
import { yandex } from "@highstate/library"
import { forUnit, getResourceComment, interpolate, type Output, toPromise } from "@highstate/pulumi"
import {
  ComputeDisk,
  ComputeInstanceGroup,
  KmsSymmetricKey,
  LbNetworkLoadBalancer,
  VpcAddress,
} from "@highstate/yandex-sdk"
import {
  buildEndpointsFromInstance,
  detectDefaultSubnetId,
  detectSubnetId,
  fetchNetworkContext,
} from "../network"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(yandex.instanceGroup)

const groupName = args.groupName ?? name
const nlbName = args.nlb.name ?? groupName
const zones = args.zones ?? [inputs.connection.defaultZone]

if (zones.length === 0) {
  throw new Error(`At least one zone must be specified`)
}

if (inputs.publicAddresses.length > 0 && inputs.publicAddresses.length !== args.size) {
  throw new Error(
    `The number of public addresses must match instance group size when any address is provided`,
  )
}

if (inputs.publicAddresses.length > 0 && !args.network.assignPublicIp) {
  throw new Error(`Cannot use public addresses when "network.assignPublicIp" is false`)
}

if (inputs.nlbPublicAddress && !args.nlb.enabled) {
  throw new Error(`Cannot use NLB public address when NLB is disabled`)
}

const provider = await createProvider(inputs.connection, args.cloudId)

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const rootPassword = getSecret("rootPassword", generatePassword)

const subnetId = await detectSubnetId(args.network.subnetId, inputs.connection, provider)
const networkContext = await fetchNetworkContext(subnetId, provider)
const getInstanceZone = (index: number): string => zones[index % zones.length]!
const subnetIdsByZone: Record<string, string> = Object.fromEntries(
  await Promise.all(
    zones.map(async zone => [
      zone,
      args.network.subnetId ?? (await detectDefaultSubnetId(zone, inputs.connection, provider)),
    ]),
  ),
)
const subnetIds = Array.from(new Set(Object.values(subnetIdsByZone)))
const getInstanceSubnetId = (index: number): string => subnetIdsByZone[getInstanceZone(index)]!

function parseNlbListener(listener: string) {
  const match = /^(tcp|udp):(\d+)(?:=>(\d+))?$/.exec(listener)

  if (!match) {
    throw new Error(
      `Invalid NLB listener "${listener}", expected "protocol:source=>target" or "protocol:port" format`,
    )
  }

  const port = Number(match[2])

  return {
    name: `${match[1]}-${port}`,
    protocol: match[1],
    port,
    targetPort: match[3] ? Number(match[3]) : port,
  }
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
      zone: getInstanceZone(i),
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
        subnetId: getInstanceSubnetId(i),
      },
    },
    { provider },
  )
})

// create public IPs if needed
let publicAddresses: Array<string | Output<string>> | undefined

if (inputs.publicAddresses.length > 0) {
  publicAddresses = [...inputs.publicAddresses]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(address => address.address)
} else if (args.network.assignPublicIp && args.network.reservePublicIp) {
  publicAddresses = Array.from({ length: args.size }, (_, i) => {
    const address = new VpcAddress(
      `address-${i + 1}`,
      {
        name: `${groupName}-${i + 1}`,
        folderId: args.folderId ?? inputs.connection.defaultFolderId,
        description: getResourceComment(),
        externalIpv4Address: {
          zoneId: getInstanceZone(i),
        },
      },
      { provider },
    )

    return address.externalIpv4Address.apply(a => a!.address)
  })
}

const nlbListeners = [
  {
    name: "ssh",
    port: args.ssh.port,
    targetPort: args.ssh.port,
    protocol: "tcp",
  },
  ...args.nlb.listeners.map(parseNlbListener),
]

if (args.nlb.enabled && nlbListeners.length === 0) {
  throw new Error(`At least one NLB listener must be specified`)
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
      zones,
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

    loadBalancer: args.nlb.enabled
      ? {
          targetGroupName: nlbName,
          targetGroupDescription: getResourceComment(),
        }
      : undefined,

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
          subnetIds,
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
        ? Object.fromEntries(publicAddresses.map((address, i) => [`address_${i + 1}`, address]))
        : {}),
    },

    serviceAccountId: inputs.connection.serviceAccountId,
  },
  { provider },
)

const nlb = args.nlb.enabled
  ? new LbNetworkLoadBalancer(
      "nlb",
      {
        name: nlbName,
        folderId: args.folderId ?? inputs.connection.defaultFolderId,
        description: getResourceComment(),
        type: "external",
        listeners: nlbListeners.map(listener => ({
          name: listener.name,
          port: listener.port,
          targetPort: listener.targetPort,
          protocol: listener.protocol,
          externalAddressSpec: {
            address: inputs.nlbPublicAddress?.address,
            ipVersion: "ipv4",
          },
        })),
        attachedTargetGroups: [
          {
            targetGroupId: instanceGroup.loadBalancer.apply(loadBalancer => {
              if (!loadBalancer?.targetGroupId) {
                throw new Error(`Could not determine instance group NLB target group ID`)
              }

              return loadBalancer.targetGroupId
            }),
            healthchecks: [
              {
                name: "main",
                interval: args.nlb.healthCheckInterval,
                timeout: args.nlb.healthCheckTimeout,
                healthyThreshold: args.nlb.healthCheckHealthyThreshold,
                unhealthyThreshold: args.nlb.healthCheckUnhealthyThreshold,
                tcpOptions:
                  args.nlb.healthCheckProtocol === "tcp"
                    ? { port: args.nlb.healthCheckPort }
                    : undefined,
                httpOptions:
                  args.nlb.healthCheckProtocol === "http"
                    ? { port: args.nlb.healthCheckPort, path: args.nlb.healthCheckPath }
                    : undefined,
              },
            ],
          },
        ],
      },
      { provider },
    )
  : undefined

const nlbSshProxyEndpoint = nlb
  ? nlb.listeners.apply(listeners => {
      const sshListener = listeners?.find(listener => listener.name === "ssh")
      const address = sshListener?.externalAddressSpec?.address

      if (!address) {
        throw new Error(`Could not determine NLB SSH listener address`)
      }

      return parseEndpoint(`tcp://${address}:${args.ssh.port}`, 4)
    })
  : undefined
const nlbSshProxy = nlbSshProxyEndpoint?.apply(endpoint => ({ endpoint, user: "root" }))
const nlbEndpoints = nlb
  ? await toPromise(
      nlb.listeners.apply(listeners => {
        const firstAddress = listeners?.find(listener => listener.externalAddressSpec?.address)
          ?.externalAddressSpec?.address

        if (!firstAddress) {
          throw new Error(`Could not determine NLB listener address`)
        }

        return nlbListeners.map(listener =>
          parseEndpoint(`${listener.protocol}://${firstAddress}:${listener.port}`, 4),
        )
      }),
    )
  : []

const terminals: UnitTerminal[] = []
const instances = await toPromise(instanceGroup.instances)
const sshArgs =
  args.network.assignPublicIp || args.nlb.enabled
    ? args.ssh
    : { ...(args.ssh ?? {}), enabled: false }

const servers = await toPromise(
  instances.map(async (instance, i) => {
    const endpoints = buildEndpointsFromInstance(
      instance,
      args.network.assignPublicIp,
      networkContext,
    )

    const { server, terminal } = await createServerBundle({
      name: `${groupName}-${i + 1}`,
      endpoints,
      sshArgs,
      sshPassword: rootPassword,
      sshKeyPair,
      sshProxy: args.nlb.enabled ? nlbSshProxy : undefined,
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
  nlbEndpoints,

  $statusFields: {
    id: instanceGroup.id,
    endpoints: servers.flatMap(server => server.endpoints).map(l3EndpointToString),
    nlbEndpoints: nlbEndpoints.map(l4EndpointToString),
  },

  $terminals: terminals,
})
