import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { serverOutputs, vmSshArgs } from "../common"
import * as ssh from "../ssh"

const icon = "simple-icons:hetzner"
const iconColor = "#D50C2D"

export const connectionEntity = defineEntity({
  type: "hetzner.connection.v1",

  schema: z.object({
    /**
     * The Hetzner Cloud API token.
     */
    apiToken: secretSchema(z.string()),

    /**
     * The default location for resources.
     */
    defaultLocation: z.string(),
  }),

  meta: {
    color: iconColor,
    title: "Hetzner Connection",
    icon,
    iconColor,
  },
})

/**
 * The connection to a Hetzner Cloud project.
 */
export const connection = defineUnit({
  type: "hetzner.connection.v1",

  args: {
    /**
     * The default location for resources.
     *
     * See [Hetzner Cloud locations](https://docs.hetzner.com/cloud/general/locations/) for available locations.
     */
    defaultLocation: z.string().default("fsn1"),
  },

  secrets: {
    /**
     * A read/write API token for the Hetzner Cloud project.
     */
    apiToken: z.string(),
  },

  outputs: {
    connection: connectionEntity,
  },

  meta: {
    title: "Hetzner Connection",
    category: "Hetzner Cloud",
    icon,
    iconColor,
  },

  source: {
    package: "@highstate/hetzner",
    path: "connection",
  },
})

export const ipAddressEntity = defineEntity({
  type: "hetzner.ip-address.v1",

  schema: z.object({
    /**
     * The ID of the IP address.
     */
    id: z.string(),

    /**
     * The name of the IP address.
     */
    name: z.string(),

    /**
     * How the IP address is attached to servers.
     */
    kind: z.enum(["primary", "floating"]),

    /**
     * The IP address family.
     */
    type: z.enum(["ipv4", "ipv6"]),

    /**
     * The IP address value.
     */
    address: z.string(),

    /**
     * The IPv6 network in CIDR notation.
     */
    network: z.string().optional(),

    /**
     * The location of the IP address.
     *
     * For Floating IPs, this is the home location used to optimize routing.
     */
    location: z.string(),
  }),

  meta: {
    title: "Hetzner IP Address",
    icon,
    iconColor,
    secondaryIcon: "mdi:ip-network-outline",
  },
})

/**
 * The reserved Primary or Floating IP address on Hetzner Cloud.
 */
export const ipAddress = defineUnit({
  type: "hetzner.ip-address.v1",

  args: {
    /**
     * The name of the IP address.
     * If not specified, the name of the unit will be used.
     */
    addressName: z.string().optional(),

    /**
     * How the IP address can be attached to servers.
     *
     * Primary IPs provide a server's main public network connectivity.
     * Floating IPs are additional addresses that can be reassigned between servers.
     */
    kind: z.enum(["primary", "floating"]).default("primary"),

    /**
     * The IP address family.
     */
    type: z.enum(["ipv4", "ipv6"]).default("ipv4"),

    /**
     * The location in which to reserve the IP address.
     * If not specified, the default location from the connection will be used.
     */
    location: z.string().optional(),
  },

  inputs: {
    connection: connectionEntity,
  },

  outputs: {
    ipAddress: ipAddressEntity,
  },

  meta: {
    title: "Hetzner IP Address",
    category: "Hetzner Cloud",
    icon,
    iconColor,
    secondaryIcon: "mdi:ip-network-outline",
  },

  source: {
    package: "@highstate/hetzner",
    path: "ip-address",
  },
})

/**
 * The virtual machine on Hetzner Cloud.
 */
export const virtualMachine = defineUnit({
  type: "hetzner.virtual-machine.v1",

  args: {
    /**
     * The name of the virtual machine.
     * If not specified, the name of the unit will be used.
     */
    vmName: z.string().optional(),

    /**
     * The server type.
     *
     * See [Hetzner Cloud server types](https://docs.hetzner.com/cloud/servers/overview/) for available types.
     */
    serverType: z.string().default("cx23"),

    /**
     * The image name or ID.
     */
    image: z.string().default("ubuntu-24.04"),

    /**
     * The location in which to create the virtual machine.
     * If not specified, the default location from the connection will be used.
     */
    location: z.string().optional(),

    /**
     * Whether to assign a public IPv4 address.
     */
    enableIpv4: z.boolean().default(true),

    /**
     * Whether to assign a public IPv6 network.
     */
    enableIpv6: z.boolean().default(false),

    /**
     * Whether to enable Hetzner Cloud backups.
     */
    backups: z.boolean().default(false),

    /**
     * The SSH configuration.
     */
    ssh: vmSshArgs,
  },

  secrets: {
    /**
     * The SSH private key for the root user in PEM format.
     *
     * If not specified or provided via sshKeyPair, one will be generated automatically.
     */
    sshPrivateKey: ssh.secrets.sshPrivateKey,
  },

  inputs: {
    connection: connectionEntity,

    /**
     * The reserved IP addresses to attach to the virtual machine.
     *
     * At most one Primary IP of each family can be attached.
     * Multiple Floating IPs are supported.
     */
    ipAddresses: {
      entity: ipAddressEntity,
      required: false,
      multiple: true,
    },

    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "Hetzner Virtual Machine",
    category: "Hetzner Cloud",
    icon,
    iconColor,
    secondaryIcon: "codicon:vm",
  },

  source: {
    package: "@highstate/hetzner",
    path: "virtual-machine",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type IpAddress = EntityValue<typeof ipAddressEntity>
export type IpAddressInput = EntityInput<typeof ipAddressEntity>
