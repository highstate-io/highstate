import {
  $args,
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { serverEntity, serverOutputs, vmSecrets, vmSshArgs } from "../common"
import * as ssh from "../ssh"

export const connectionEntity = defineEntity({
  type: "gcp.connection.v1",

  schema: z.object({
    /**
     * The service account JSON key used for authentication.
     */
    serviceAccountKeyJson: secretSchema(z.string()),

    /**
     * The ID of the Google Cloud project.
     */
    projectId: z.string(),

    /**
     * The default region.
     */
    defaultRegion: z.string(),

    /**
     * The default availability zone.
     */
    defaultZone: z.string().optional(),
  }),

  meta: {
    color: "#4285F4",
    title: "GCP Connection",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
  },
})

/**
 * The connection to a Google Cloud account.
 */
export const connection = defineUnit({
  type: "gcp.connection.v1",

  args: {
    /**
     * The region to create connection for.
     */
    region: z
      .object({
        /**
         * The ID of the region.
         */
        id: z.string().default("us-central1"),

        /**
         * The default availability zone in the selected region.
         *
         * If not specified, an available zone in the region will be selected automatically.
         */
        defaultZone: z.string().optional(),
      })
      .prefault({}),
  },

  secrets: {
    /**
     * The JSON service account key.
     */
    serviceAccountKeyJson: {
      schema: z.string().meta({ language: "json" }),
      meta: {
        title: "Service Account Key JSON",
      },
    },
  },

  inputs: {
    ...ssh.inputs,
  },

  outputs: {
    /**
     * The Google Cloud connection.
     */
    connection: connectionEntity,
  },

  meta: {
    title: "GCP Connection",
    category: "Google Cloud",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
  },

  source: {
    package: "@highstate/gcp",
    path: "connection",
  },
})

export const diskSchema = z.object({
  /**
   * The disk type.
   */
  type: z.enum(["pd-standard", "pd-balanced", "pd-ssd", "pd-extreme"]).default("pd-balanced"),

  /**
   * The disk size in GB.
   */
  size: z.number().default(20),

  /**
   * Whether the disk should be encrypted with a separate KMS key.
   */
  encrypted: z.boolean().default(false),
})

export const diskEntity = defineEntity({
  type: "gcp.disk.v1",

  schema: z.object({
    /**
     * The global ID of the disk.
     */
    id: z.string(),
  }),

  meta: {
    title: "GCP Disk",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
    secondaryIcon: "icon-park-outline:disk",
  },
})

/**
 * The disk on Google Cloud.
 */
export const disk = defineUnit({
  type: "gcp.disk.v1",

  args: {
    /**
     * The name of the disk in the project.
     * If not specified, the name of the unit will be used.
     */
    diskName: z.string().optional(),

    ...diskSchema.shape,
  },

  inputs: {
    connection: connectionEntity,
  },

  outputs: {
    /**
     * The disk entity.
     */
    disk: diskEntity,
  },

  meta: {
    title: "GCP Disk",
    category: "Google Cloud",
    icon: "icon-park-outline:disk",
    iconColor: "#4285F4",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/gcp",
    path: "disk",
  },
})

export const imageEntity = defineEntity({
  type: "gcp.image.v1",

  schema: z.object({
    /**
     * The global ID of the image.
     */
    id: z.string(),
  }),

  meta: {
    title: "GCP Image",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
    secondaryIcon: "mage:compact-disk-fill",
  },
})

/**
 * The existing image from Google Cloud public images or custom images.
 */
export const existingImage = defineUnit({
  type: "gcp.existing-image.v1",

  args: {
    /**
     * The ID or self-link of the image.
     *
     * See [Compute Engine public images](https://cloud.google.com/compute/docs/images/os-details)
     * and [Google Cloud Marketplace](https://console.cloud.google.com/marketplace)
     * to find available images.
     */
    id: z.string(),
  },

  inputs: {
    connection: connectionEntity,
  },

  outputs: {
    /**
     * The image entity.
     */
    image: imageEntity,
  },

  meta: {
    title: "GCP Existing Image",
    category: "Google Cloud",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/gcp",
    path: "existing-image",
  },
})

const vmArgs = $args({
  /**
   * The machine type for the instance.
   */
  machineType: z.string().default("e2-standard-2"),

  /**
   * The boot disk configuration.
   */
  bootDisk: diskSchema.prefault({}),

  /**
   * The network configuration.
   */
  network: z
    .object({
      /**
       * The subnetwork self-link to connect to.
       * If not specified, will auto-discover the default subnet for the zone.
       */
      subnetworkId: z.string().optional(),

      /**
       * Whether to assign a public IP.
       */
      assignPublicIp: z.boolean().default(true),

      /**
       * Whether to reserve the public IP permanently.
       */
      reservePublicIp: z.boolean().default(true),
    })
    .prefault({}),

  /**
   * The SSH configuration.
   */
  ssh: vmSshArgs,

  /**
   * Whether the virtual machine is preemptible.
   */
  preemptible: z.boolean().default(false),
})

/**
 * The virtual machine on Google Cloud.
 */
export const virtualMachine = defineUnit({
  type: "gcp.virtual-machine.v1",

  args: {
    /**
     * The name of the virtual machine.
     * If not specified, the name of the unit will be used.
     */
    vmName: z.string().optional(),

    /**
     * The ID of the project to create the VM in.
     * If not specified, will use the project from the connection.
     */
    projectId: z.string().optional(),

    /**
     * The region to create the VM in.
     * If not specified, will use the region from the connection.
     */
    region: z.string().optional(),

    /**
     * The zone to create the VM in.
     * If not specified, will use the default zone from the connection.
     */
    zone: z.string().optional(),

    ...vmArgs,
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    connection: connectionEntity,
    image: imageEntity,
    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "GCP Virtual Machine",
    category: "Google Cloud",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
    secondaryIcon: "codicon:vm",
  },

  source: {
    package: "@highstate/gcp",
    path: "virtual-machine",
  },
})

/**
 * The managed instance group on Google Cloud.
 */
export const instanceGroup = defineUnit({
  type: "gcp.instance-group.v1",

  args: {
    /**
     * The name of the instance group.
     * If not specified, the name of the unit will be used.
     */
    groupName: z.string().optional(),

    /**
     * The ID of the project to create the instance group in.
     * If not specified, will use the project from the connection.
     */
    projectId: z.string().optional(),

    /**
     * The region to create the instance group in.
     * If not specified, will use the region from the connection.
     */
    region: z.string().optional(),

    /**
     * The zone to create the instance group in.
     * If not specified, will use the default zone from the connection.
     */
    zone: z.string().optional(),

    /**
     * The number of instances to create in the group.
     */
    size: z.number().default(1),

    ...vmArgs,
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    connection: connectionEntity,
    image: imageEntity,
    ...ssh.inputs,
  },

  outputs: {
    servers: {
      entity: serverEntity,
      multiple: true,
    },
  },

  meta: {
    title: "GCP Instance Group",
    category: "Google Cloud",
    icon: "material-icon-theme:gcp",
    iconColor: "#4285F4",
    secondaryIcon: "mdi:group",
  },

  source: {
    package: "@highstate/gcp",
    path: "instance-group",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type Disk = EntityValue<typeof diskEntity>
export type DiskInput = EntityInput<typeof diskEntity>

export type Image = EntityValue<typeof imageEntity>
export type ImageInput = EntityInput<typeof imageEntity>
