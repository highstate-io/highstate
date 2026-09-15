import {
  createServerBundle,
  generateSshPrivateKey,
  l3EndpointToString,
  parseEndpoint,
  sshPrivateKeyToKeyPair,
} from "@highstate/common"
import { trimIndentation } from "@highstate/contract"
import { hetzner } from "@highstate/library"
import { forUnit, type Input, interpolate, output, toPromise } from "@highstate/pulumi"
import { FloatingIpAssignment, PrimaryIp, Server, SshKey } from "@pulumi/hcloud"
import { createProvider } from "../provider"

const { name, args, getSecret, inputs, outputs } = forUnit(hetzner.virtualMachine)

const vmName = args.vmName ?? name
const location = args.location ?? inputs.connection.defaultLocation
const provider = await createProvider(inputs.connection)

if (!args.enableIpv4 && !args.enableIpv6) {
  throw new Error("At least one of enableIpv4 and enableIpv6 must be true")
}

const providedAddresses = inputs.ipAddresses ?? []
for (const address of providedAddresses) {
  if (address.location !== location) {
    throw new Error(
      `IP address location "${address.location}" does not match virtual machine location "${location}"`,
    )
  }

  if (address.type === "ipv4" && !args.enableIpv4) {
    throw new Error("Cannot attach an IPv4 address when enableIpv4 is false")
  }

  if (address.type === "ipv6" && !args.enableIpv6) {
    throw new Error("Cannot attach an IPv6 address when enableIpv6 is false")
  }
}

const primaryAddresses = providedAddresses.filter(address => address.kind === "primary")
const floatingAddresses = providedAddresses.filter(address => address.kind === "floating")
const providedIpv4 = primaryAddresses.filter(address => address.type === "ipv4")
const providedIpv6 = primaryAddresses.filter(address => address.type === "ipv6")

if (providedIpv4.length > 1 || providedIpv6.length > 1) {
  throw new Error("At most one Primary IP address of each family can be attached")
}

const sshKeyPair =
  inputs.sshKeyPair ??
  getSecret("sshPrivateKey", generateSshPrivateKey).apply(sshPrivateKeyToKeyPair)

const sshKey = new SshKey(
  "ssh-key",
  {
    name: vmName,
    publicKey: sshKeyPair.publicKey,
    labels: {
      "managed-by": "highstate",
    },
  },
  { provider },
)

function createAddress(type: "ipv4" | "ipv6"): PrimaryIp {
  return new PrimaryIp(
    `${type}-address`,
    {
      name: `${vmName}-${type}`,
      location,
      type,
      autoDelete: false,
      labels: {
        "managed-by": "highstate",
      },
    },
    { provider },
  )
}

const ipv4Id: Input<string> | undefined = args.enableIpv4
  ? (providedIpv4[0]?.id ?? createAddress("ipv4").id)
  : undefined
const ipv6Id: Input<string> | undefined = args.enableIpv6
  ? (providedIpv6[0]?.id ?? createAddress("ipv6").id)
  : undefined

const floatingAddressSetup = output(floatingAddresses).apply(addresses => {
  return addresses
    .map(address => {
      const prefixLength = address.type === "ipv4" ? 32 : 64
      return `ip address replace ${address.address}/${prefixLength} dev "$interface"`
    })
    .join("\n")
})

const userData = interpolate`
  #cloud-config
  hostname: ${vmName}
  users:
    - name: root
      ssh-authorized-keys:
        - ${sshKeyPair.publicKey}
      sudo: ALL=(ALL) NOPASSWD:ALL
  write_files:
    - path: /usr/local/sbin/highstate-floating-ips
      permissions: "0755"
      content: |
        #!/bin/sh
        set -eu
        interface="$(ip route show default | sed -n 's/.* dev \\([^ ]*\\).*/\\1/p' | head -n 1)"
        if [ -z "$interface" ]; then
          interface="$(ip -6 route show default | sed -n 's/.* dev \\([^ ]*\\).*/\\1/p' | head -n 1)"
        fi
        if [ -z "$interface" ]; then
          echo "No default network interface found" >&2
          exit 1
        fi
        ${floatingAddressSetup}
    - path: /etc/systemd/system/highstate-floating-ips.service
      permissions: "0644"
      content: |
        [Unit]
        Description=Configure Hetzner Floating IPs
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=oneshot
        ExecStart=/usr/local/sbin/highstate-floating-ips
        RemainAfterExit=yes

        [Install]
        WantedBy=multi-user.target
  runcmd:
    - systemctl daemon-reload
    - systemctl enable --now highstate-floating-ips.service
`.apply(trimIndentation)

const server = new Server(
  "virtual-machine",
  {
    name: vmName,
    serverType: args.serverType,
    image: args.image,
    location,
    backups: args.backups,
    shutdownBeforeDeletion: true,
    sshKeys: [sshKey.id],
    userData,
    labels: {
      "managed-by": "highstate",
    },
    publicNets: [
      {
        ipv4Enabled: args.enableIpv4,
        ipv4: ipv4Id ? output(ipv4Id).apply(Number) : undefined,
        ipv6Enabled: args.enableIpv6,
        ipv6: ipv6Id ? output(ipv6Id).apply(Number) : undefined,
      },
    ],
  },
  { provider },
)

floatingAddresses.forEach((address, index) => {
  new FloatingIpAssignment(
    `floating-ip-${index}`,
    {
      floatingIpId: output(address.id).apply(Number),
      serverId: server.id.apply(Number),
    },
    { provider },
  )
})

const assignedAddresses = await toPromise(
  output({
    floatingAddresses: output(floatingAddresses).apply(addresses =>
      addresses.map(address => address.address),
    ),
    ipv4Address: args.enableIpv4 ? server.ipv4Address : undefined,
    ipv6Address: args.enableIpv6 ? server.ipv6Address : undefined,
  }),
)

const endpointAddresses = [...assignedAddresses.floatingAddresses]
if (assignedAddresses.ipv4Address) {
  endpointAddresses.push(assignedAddresses.ipv4Address)
}
if (assignedAddresses.ipv6Address) {
  endpointAddresses.push(assignedAddresses.ipv6Address)
}

const endpoints = endpointAddresses.map(address => parseEndpoint(address, 3))

const { server: serverEntity, terminal } = await createServerBundle({
  name: vmName,
  endpoints,
  sshArgs: args.ssh,
  sshKeyPair,
})

export default outputs({
  server: serverEntity,

  $statusFields: {
    id: server.id,
    endpoints: endpoints.map(l3EndpointToString),
    hostname: serverEntity.hostname,
    location,
  },

  $terminals: [terminal],
})
