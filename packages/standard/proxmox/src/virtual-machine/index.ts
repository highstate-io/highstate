import type {
  VirtualEnvironmentVmInitialization,
  VirtualEnvironmentVmNetworkDevice,
} from "@highstate/proxmox-sdk/types/input"
import {
  createServerBundle,
  generatePassword,
  generateSshPrivateKey,
  l3EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { proxmox } from "@highstate/library"
import { VirtualEnvironmentFile, VirtualEnvironmentVm } from "@highstate/proxmox-sdk"
import { forUnit, getResourceComment, type Input, output, toPromise } from "@highstate/pulumi"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(proxmox.virtualMachine)

const vmName = args.vmName ?? name

const provider = await createProvider(inputs.proxmoxCluster)

const nodeName = args.nodeName ?? inputs.proxmoxCluster.defaultNodeName
const datastoreId = args.datastoreId ?? inputs.proxmoxCluster.defaultDatastoreId
const inputVendorData = await toPromise(inputs.vendorData)

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const rootPassword = getSecret("rootPassword", generatePassword)

const machine = new VirtualEnvironmentVm(
  "virtual-machine",
  {
    name: vmName,
    nodeName,
    description: getResourceComment(),
    agent: {
      enabled: true,
    },
    cpu: {
      cores: args.resources.cores,
      sockets: args.resources.sockets,
      type: args.cpuType,
    },
    memory: {
      dedicated: args.resources.memory,
    },
    disks: [
      {
        interface: "virtio0",
        size: args.resources.diskSize,
        iothread: true,
        discard: "on",
        datastoreId,
        fileId: inputs.image.id,
      },
    ],
    networkDevices: [
      {
        bridge: args.network.bridge,
      },
    ] as Input<VirtualEnvironmentVmNetworkDevice>[],
    initialization: createCloudInit(),
  },
  { provider, ignoreChanges: ["disks", "cdrom"] },
)

function findNonLocalHostIpV4(ips: string[][]): string {
  for (const ip of ips) {
    if (ip[0] && ip[0] !== "127.0.0.1" && ip[0] !== "::1") {
      return ip[0]
    }
  }

  throw new Error("No non-local host IP found")
}

function deriveIpV4Gateway(ip: string): string {
  return `${ip.split(".").slice(0, 3).join(".")}.1`
}

function createCloudInit(): VirtualEnvironmentVmInitialization {
  let vendorDataFileId: Input<string> | undefined

  if (args.vendorData || inputVendorData) {
    let vendorData: string | undefined = args.vendorData

    if (!vendorData) {
      if (inputVendorData!.content.type !== "embedded") {
        throw new Error("For now, only the embedded vendor data is supported.")
      }

      vendorData = inputVendorData!.content.value
    }

    const file = new VirtualEnvironmentFile(
      "vendor-data",
      {
        datastoreId,
        nodeName,
        contentType: "snippets",
        sourceRaw: {
          fileName: `${vmName}-vendor-data.yaml`,
          data: vendorData,
        },
      },
      { provider },
    )

    vendorDataFileId = file.id
  }

  return {
    datastoreId,
    interface: "ide2",

    ipConfigs:
      args.ipv4.type === "static"
        ? [
            {
              ipv4: {
                address: `${args.ipv4.address}/${args.ipv4.prefix}`,
                gateway: args.ipv4.gateway ?? deriveIpV4Gateway(args.ipv4.address),
              },
            },
          ]
        : [
            {
              ipv4: {
                address: "dhcp",
              },
            },
          ],

    dns: args.network.dns.length > 0 ? { servers: args.network.dns } : undefined,

    userAccount: output({
      keys: [sshKeyPair.publicKey],
      username: "root",
      password: rootPassword,
    }),

    vendorDataFileId,
  }
}

const ipv4Addresses = await toPromise(machine.ipv4Addresses)
const nonLocalHostIpV4 = findNonLocalHostIpV4(ipv4Addresses)

const endpoint = parseEndpoint(nonLocalHostIpV4)

const { server, terminal } = await createServerBundle({
  name: vmName,
  endpoints: [endpoint],
  sshArgs: args.ssh,
  sshPassword: rootPassword,
  sshPrivateKey: sshKeyPair.privateKey.value,
  sshKeyPair,
})

export default outputs({
  server,

  $statusFields: {
    endpoints: [l3EndpointToString(endpoint)],
    hostname: vmName,
  },

  $terminals: [terminal],
})
