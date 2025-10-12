import { defineEntity, defineUnit, z } from "@highstate/contract"
import {
  checksumSchema,
  fileEntity,
  serverEntity,
  serverOutputs,
  vmSecrets,
  vmSshArgs,
} from "./common"
import { ipv4PrefixSchema, ipv46Schema, l7EndpointEntity } from "./network"
import * as ssh from "./ssh"

export const clusterEntity = defineEntity({
  type: "proxmox.cluster.v1",

  schema: z.object({
    endpoint: l7EndpointEntity.schema,
    insecure: z.boolean().optional(),
    username: z.string().optional(),

    defaultNodeName: z.string(),
    defaultDatastoreId: z.string(),

    password: z.string().optional(),
    apiToken: z.string().optional(),

    ssh: ssh.connectionSchema.optional(),
  }),

  meta: {
    color: "#e56901",
  },
})

export const imageEntity = defineEntity({
  type: "proxmox.image.v1",

  schema: z.object({
    id: z.string(),
  }),

  meta: {
    color: "#e56901",
  },
})

/**
 * The connection to an existing Proxmox cluster.
 */
export const connection = defineUnit({
  type: "proxmox.connection.v1",

  args: {
    /**
     * The endpoint of the Proxmox API.
     */
    endpoint: z.string(),

    /**
     * Whether to allow insecure connections to the Proxmox API.
     */
    insecure: z.boolean().optional(),

    /**
     * The username to use for the Proxmox API.
     *
     * Only required for password token authentication.
     */
    username: z.string().optional(),

    /**
     * The name of the default Proxmox node to use for operations.
     *
     * If not specified, the first node in the cluster will be used.
     */
    defaultNodeName: z.string().optional(),

    /**
     * The ID of the default Proxmox datastore to use for operations.
     *
     * If not specified, the first datastore in the cluster will be used.
     */
    defaultDatastoreId: z.string().optional(),

    /**
     * The SSH configuration to use for connecting to the Proxmox nodes.
     */
    ssh: ssh.argsSchema.prefault({}),
  },

  secrets: {
    /**
     * The password to use for the Proxmox API.
     *
     * Requires `username` to be set.
     */
    password: {
      schema: z.string().optional(),
      meta: {
        title: "Proxmox Password",
      },
    },

    /**
     * The Proxmox API token to use for authentication.
     */
    apiToken: {
      schema: z.string().optional(),
      meta: {
        title: "Proxmox API Token",
      },
    },

    ...ssh.secrets,
  },

  inputs: {
    ...ssh.inputs,
  },

  outputs: {
    /**
     * The Proxmox cluster.
     */
    proxmoxCluster: clusterEntity,

    /**
     * The server representing the Proxmox API endpoint.
     */
    server: {
      entity: serverEntity,
      required: false,
    },
  },

  meta: {
    title: "Proxmox Connection",
    category: "Proxmox",
    icon: "simple-icons:proxmox",
    iconColor: "#e56901",
  },

  source: {
    package: "@highstate/proxmox",
    path: "connection",
  },
})

/**
 * The image to upload to a Proxmox cluster.
 */
export const image = defineUnit({
  type: "proxmox.image.v1",

  args: {
    /**
     * The name of the image to upload.
     *
     * If not specified, the default name is `<unitName>-<sha256>.<extension>`
     * or `<unitName>.<extension>` if `sha256` is not provided.
     */
    fileName: z.string().optional(),

    /**
     * The URL of the image to upload.
     */
    url: z.string().optional(),

    /**
     * The checksum of the image file to verify.
     */
    checksum: checksumSchema.optional(),

    /**
     * The name of the Proxmox node to upload the image to.
     *
     * If not specified, the default node name from the cluster will be used.
     */
    nodeName: z.string().optional(),

    /**
     * The ID of the Proxmox datastore to upload the image to.
     *
     * If not specified, the default datastore ID from the cluster will be used.
     */
    datastoreId: z.string().optional(),
  },

  inputs: {
    /**
     * The Proxmox cluster to upload the image to.
     */
    proxmoxCluster: clusterEntity,

    /**
     * The file to upload as an image.
     *
     * If `url` is not specified, this file will be used.
     */
    file: {
      entity: fileEntity,
      required: false,
    },
  },

  outputs: {
    image: imageEntity,
  },

  meta: {
    title: "Proxmox Image",
    category: "Proxmox",
    icon: "simple-icons:proxmox",
    iconColor: "#e56901",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/proxmox",
    path: "image",
  },
})

/**
 * The existing image on a Proxmox cluster.
 */
export const existingImage = defineUnit({
  type: "proxmox.existing-image.v1",

  args: {
    id: z.string(),
  },

  inputs: {
    proxmoxCluster: clusterEntity,
  },

  outputs: {
    image: imageEntity,
  },

  meta: {
    title: "Proxmox Existing Image",
    category: "Proxmox",
    icon: "simple-icons:proxmox",
    iconColor: "#e56901",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/proxmox",
    path: "existing-image",
  },
})

/**
 * The virtual machine on a Proxmox cluster.
 */
export const virtualMachine = defineUnit({
  type: "proxmox.virtual-machine.v1",

  args: {
    /**
     * The name of the node to create the virtual machine on.
     *
     * If not specified, the default node name from the cluster will be used.
     */
    nodeName: z.string().optional(),

    /**
     * The ID of the Proxmox datastore to create the virtual machine on.
     *
     * If not specified, the default datastore ID from the cluster will be used.
     */
    datastoreId: z.string().optional(),

    /**
     * The type of CPU to use for the virtual machine.
     *
     * By default, this is set to "host" which offers the best performance.
     */
    cpuType: z.string().default("host"),

    /**
     * The resources to allocate to the virtual machine.
     */
    resources: z
      .object({
        /**
         * The number of CPU cores to allocate to the virtual machine.
         *
         * By default, this is set to 1.
         */
        cores: z.number().default(1),

        /**
         * The number of CPU sockets to allocate to the virtual machine.
         *
         * By default, this is set to 1.
         */
        sockets: z.number().default(1),

        /**
         * The amount of dedicated memory to allocate to the virtual machine, in MB.
         *
         * By default, this is set to 512 MB.
         */
        memory: z.number().default(512),

        /**
         * The size of the disk to create for the virtual machine, in GB.
         *
         * By default, this is set to 8 GB.
         */
        diskSize: z.number().default(8),
      })
      .prefault({}),

    /**
     * The IPv4 address configuration for the virtual machine.
     */
    ipv4: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("dhcp"),
        }),
        z.object({
          type: z.literal("static"),

          /**
           * The IPv4 address to assign to the virtual machine.
           */
          address: z.ipv4(),

          /**
           * The CIDR prefix for the IPv4 address.
           *
           * By default, this is set to 24.
           */
          prefix: ipv4PrefixSchema.default(24),

          /**
           * The IPv4 gateway for the virtual machine.
           *
           * If not specified, will be set to the first address in the subnet.
           */
          gateway: z.ipv4().optional(),
        }),
      ])
      .default({ type: "dhcp" }),

    /**
     * The network configuration for the virtual machine.
     */
    network: z
      .object({
        /**
         * The list of DNS servers to use for the virtual machine.
         */
        dns: ipv46Schema.array().default([]),

        /**
         * The name of the network bridge to connect the virtual machine to.
         *
         * By default, this is set to "vmbr0".
         */
        bridge: z.string().default("vmbr0"),
      })
      .prefault({}),

    /**
     * The SSH configuration for the virtual machine.
     */
    ssh: vmSshArgs,

    /**
     * Whether to wait for the Proxmox agent to be ready before returning.
     */
    waitForAgent: z.boolean().default(true),

    /**
     * The cloud-init vendor data to use for the virtual machine.
     *
     * Will take precedence over the `vendorData` input.
     */
    vendorData: z.string().optional().meta({ multiline: true }),
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    proxmoxCluster: clusterEntity,
    image: imageEntity,

    /**
     * The cloud-init vendor data to use for the virtual machine.
     *
     * You can provide a cloud-config from the distribution component.
     */
    vendorData: {
      entity: fileEntity,
      required: false,
    },

    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "Proxmox Virtual Machine",
    category: "Proxmox",
    icon: "simple-icons:proxmox",
    iconColor: "#e56901",
    secondaryIcon: "codicon:vm",
  },

  source: {
    package: "@highstate/proxmox",
    path: "virtual-machine",
  },
})

export type Cluster = z.infer<typeof clusterEntity.schema>
export type Image = z.infer<typeof imageEntity.schema>
