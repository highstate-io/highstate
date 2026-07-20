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
import { l4EndpointEntity, portSchema } from "../network"
import * as ssh from "../ssh"

export const connectionEntity = defineEntity({
  type: "yandex.connection.v1",

  schema: z.object({
    /**
     * The JSON of the authorized key for the service account.
     */
    authorizedKeyJson: secretSchema(z.string()),

    /**
     * The ID of the cloud.
     */
    cloudId: z.string(),

    /**
     * The default folder ID.
     */
    defaultFolderId: z.string(),

    /**
     * The default availability zone.
     */
    defaultZone: z.string(),

    /**
     * The region ID.
     */
    regionId: z.string().optional(),

    /**
     * The ID of the service account used for authentication.
     */
    serviceAccountId: z.string(),
  }),

  meta: {
    color: "#0080ff",
    title: "YC Connection",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
  },
})

/**
 * The connection to a Yandex Cloud account.
 */
export const connection = defineUnit({
  type: "yandex.connection.v1",

  args: {
    /**
     * The region to create connection for.
     *
     * See [Regions](https://yandex.cloud/en/docs/overview/concepts/region) for details.
     */
    region: z
      .discriminatedUnion("id", [
        z.object({
          /**
           * The ID of the region.
           */
          id: z.literal("ru-central1"),

          /**
           * The default availability zone in ru-central1 to place resources in.
           */
          defaultZone: z
            .enum(["ru-central1-a", "ru-central1-b", "ru-central1-d", "ru-central1-e"])
            .default("ru-central1-d"),
        }),
        z.object({
          /**
           * The ID of the region.
           */
          id: z.literal("kz1"),

          /**
           * The default availability zone in kz1 to place resources in.
           */
          defaultZone: z.enum(["kz1-a"]).default("kz1-a"),
        }),
      ])
      .prefault({ id: "ru-central1" }),
  },

  secrets: {
    /**
     * The JSON of the authorized key for the service account.
     *
     * Important: service account must have `iam.serviceAccounts.user` role to work properly.
     *
     * See [Creating an authorized key](https://yandex.cloud/en/docs/iam/operations/authentication/manage-authorized-keys#create-authorized-key) for details.
     */
    authorizedKeyJson: {
      schema: z.string().meta({ language: "json" }),
      meta: {
        title: "Authorized Key JSON",
      },
    },
  },

  inputs: {
    ...ssh.inputs,
  },

  outputs: {
    /**
     * The Yandex Cloud connection.
     */
    connection: connectionEntity,
  },

  meta: {
    title: "YC Connection",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
  },

  source: {
    package: "@highstate/yandex",
    path: "connection",
  },
})

export const diskSchema = z.object({
  /**
   * The disk type.
   *
   * - Network SSD (network-ssd): Fast network drive; SSD network block storage.
   * - Network HDD (network-hdd): Standard network drive; HDD network block storage.
   * - Non-replicated SSD (network-ssd-nonreplicated): Enhanced performance network drive without redundancy.
   * - Ultra high-speed network storage with three replicas (SSD) (network-ssd-io-m3): High-performance SSD offering the same speed as network-ssd-nonreplicated, plus redundancy.
   */
  type: z
    .enum(["network-ssd", "network-hdd", "network-ssd-nonreplicated", "network-ssd-io-m3"])
    .default("network-ssd"),

  /**
   * The disk size in GB.
   *
   * For `network-ssd-nonreplicated` and `network-ssd-io-m3` must be multiple of 93.
   */
  size: z.number().default(20),

  /**
   * Whether the disk should be encrypted by separate key in KMS.
   *
   * If `true`, a new key will be created for the disk.
   */
  encrypted: z.boolean().default(true),
})

export const diskEntity = defineEntity({
  type: "yandex.disk.v1",

  schema: z.object({
    /**
     * The global ID of the disk.
     */
    id: z.string(),
  }),

  meta: {
    title: "YC Disk",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "icon-park-outline:disk",
  },
})

/**
 * The disk on Yandex Cloud.
 */
export const disk = defineUnit({
  type: "yandex.disk.v1",

  args: {
    /**
     * The name of the disk in the folder.
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
    title: "YC Disk",
    category: "Yandex Cloud",
    icon: "icon-park-outline:disk",
    iconColor: "#0080ff",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/yandex",
    path: "disk",
  },
})

export const publicAddressEntity = defineEntity({
  type: "yandex.public-address.v1",

  schema: z.object({
    /**
     * The global ID of the public address.
     */
    id: z.string(),

    /**
     * The name of the public address.
     */
    name: z.string(),

    /**
     * The IPv4 address value.
     */
    address: z.string(),
  }),

  meta: {
    title: "YC Public Address",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "mdi:ip-network-outline",
  },
})

/**
 * The reserved public IPv4 address on Yandex Cloud.
 */
export const publicAddress = defineUnit({
  type: "yandex.public-address.v1",

  args: {
    /**
     * The name of the public address in the folder.
     * If not specified, the name of the unit will be used.
     */
    addressName: z.string().optional(),

    /**
     * The ID of the cloud to create the public address in.
     * If not specified, will use the cloud from the connection.
     */
    cloudId: z.string().optional(),

    /**
     * The ID of the folder to create the public address in.
     * If not specified, will use the default folder from the connection.
     */
    folderId: z.string().optional(),

    /**
     * The availability zone to reserve the address in.
     * If not specified, will use the default zone from the connection.
     */
    zone: z.string().optional(),
  },

  inputs: {
    connection: connectionEntity,
  },

  outputs: {
    /**
     * The public address entity.
     */
    publicAddress: publicAddressEntity,
  },

  meta: {
    title: "YC Public Address",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "mdi:ip-network-outline",
  },

  source: {
    package: "@highstate/yandex",
    path: "public-address",
  },
})

export const imageEntity = defineEntity({
  type: "yandex.image.v1",

  schema: z.object({
    /**
     * The global ID of the image.
     */
    id: z.string(),
  }),

  meta: {
    title: "YC Image",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "mage:compact-disk-fill",
  },
})

/**
 * The existing image from Yandex Cloud Marketplace or user images.
 */
export const existingImage = defineUnit({
  type: "yandex.existing-image.v1",

  args: {
    /**
     * The ID of the image.
     *
     * See [Yandex Cloud Marketplace Images](https://yandex.cloud/en/marketplace) to find available images and their IDs.
     * You can also use user images by specifying their IDs.
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
    title: "YC Existing Image",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "mage:compact-disk-fill",
  },

  source: {
    package: "@highstate/yandex",
    path: "existing-image",
  },
})

export const platformIdSchema = z.enum([
  // standard platforms
  "standard-v1",
  "standard-v2",
  "standard-v3",
  "amd-v1",
  "standard-v4a",

  // high-performance platforms
  "highfreq-v3",
  "highfreq-v4a",

  // with gpu
  "gpu-standard-v1",
  "gpu-standard-v2",
  "gpu-standard-v3",
  "gpu-standard-v3i",
  "standard-v3-t4",
  "standard-v3-t4i",
  "gpu-platform-v4",
])

const vmArgs = $args({
  /**
   * The platform ID for the instance.
   *
   * See [Platforms](https://yandex.cloud/en/docs/compute/concepts/vm-platforms) for details.
   */
  platformId: platformIdSchema.default("standard-v3"),

  /**
   * The resources to allocate to the virtual machine.
   */
  resources: z
    .object({
      /**
       * The number of CPU cores.
       */
      cores: z.number().default(2),

      /**
       * The amount of memory in GB.
       */
      memory: z.number().default(4),

      /**
       * The guaranteed CPU core performance (10-100).
       */
      coreFraction: z.number().min(10).max(100).default(100),
    })
    .prefault({}),

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
       * The subnet ID to connect to.
       * If not specified, will auto-discover the default subnet for the zone.
       */
      subnetId: z.string().optional(),

      /**
       * Whether to assign a public IP.
       */
      assignPublicIp: z.boolean().default(true),

      /**
       * Whether to reserve the public IP permanently.
       *
       * If not set, the public IP can be changed when the VM is stopped and started again.
       *
       * Makes no sense if `assignPublicIp` is false.
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
   *
   * See [Preemptible VMs](https://yandex.cloud/en/docs/compute/concepts/preemptible-vms) for details.
   */
  preemptible: z.boolean().default(false),
})

const nlbArgs = z.object({
  /**
   * Whether to create a network load balancer for the instance group.
   */
  enabled: z.boolean().default(false),

  /**
   * The name of the network load balancer.
   * If not specified, the instance group name will be used.
   */
  name: z.string().optional(),

  /**
   * The load-balanced ports to expose through the shared public address.
   *
   * Each listener must use `protocol:source=>target` format, for example `tcp:80=>8080`.
   *
   * If the source and target ports are the same, use `protocol:port` shorthand, for example `tcp:80`.
   *
   * When SSH is enabled, the `tcp:<ssh-port>` listener is included automatically.
   */
  listeners: z.string().array().default([]),

  /**
   * The health check protocol.
   */
  healthCheckProtocol: z.enum(["tcp", "http"]).default("tcp"),

  /**
   * The port to use for health checks.
   */
  healthCheckPort: portSchema.default(22),

  /**
   * The HTTP path to use for health checks.
   */
  healthCheckPath: z.string().default("/"),

  /**
   * The interval between health checks in seconds.
   */
  healthCheckInterval: z.number().int().min(1).max(60).default(2),

  /**
   * The timeout for health check responses in seconds.
   */
  healthCheckTimeout: z.number().int().min(1).max(60).default(1),

  /**
   * The number of successful checks required to mark a target healthy.
   */
  healthCheckHealthyThreshold: z.number().int().default(2),

  /**
   * The number of failed checks required to mark a target unhealthy.
   */
  healthCheckUnhealthyThreshold: z.number().int().default(2),
})

/**
 * The virtual machine on Yandex Cloud.
 */
export const virtualMachine = defineUnit({
  type: "yandex.virtual-machine.v1",

  args: {
    /**
     * The name of the virtual machine.
     * If not specified, the name of the unit will be used.
     */
    vmName: z.string().optional(),

    /**
     * The ID of the cloud to create the VM in.
     * If not specified, will use the cloud from the connection.
     */
    cloudId: z.string().optional(),

    /**
     * The ID of the folder to create the VM in.
     * If not specified, will use the default folder from the connection.
     */
    folderId: z.string().optional(),

    ...vmArgs,
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    connection: connectionEntity,
    image: imageEntity,

    /**
     * The reserved public address to attach to the virtual machine.
     */
    publicAddress: {
      entity: publicAddressEntity,
      required: false,
    },

    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "YC Virtual Machine",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "codicon:vm",
  },

  source: {
    package: "@highstate/yandex",
    path: "virtual-machine",
  },
})

/**
 * The instance group on Yandex Cloud.
 */
export const instanceGroup = defineUnit({
  type: "yandex.instance-group.v1",

  args: {
    /**
     * The name of the instance group.
     * If not specified, the name of the unit will be used.
     */
    groupName: z.string().optional(),

    /**
     * The ID of the cloud to create the instance group in.
     * If not specified, will use the cloud from the connection.
     */
    cloudId: z.string().optional(),

    /**
     * The ID of the folder to create the instance group in.
     * If not specified, will use the default folder from the connection.
     */
    folderId: z.string().optional(),

    /**
     * The number of instances to create in the group.
     */
    size: z.number().default(1),

    /**
     * The zones to spread instances across.
     * If not specified, will use the default zone from the connection.
     */
    zones: z.string().array().optional(),

    /**
     * The network load balancer configuration.
     */
    nlb: nlbArgs.prefault({}),

    ...vmArgs,
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    connection: connectionEntity,
    image: imageEntity,

    /**
     * The public addresses to attach to instances.
     * Addresses are sorted by name and assigned to instances in that order.
     */
    publicAddresses: {
      entity: publicAddressEntity,
      required: false,
      multiple: true,
    },

    /**
     * The reserved public address to use for the network load balancer.
     */
    nlbPublicAddress: {
      entity: publicAddressEntity,
      required: false,
    },

    ...ssh.inputs,
  },

  outputs: {
    servers: {
      entity: serverEntity,
      multiple: true,
    },

    nlbEndpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  meta: {
    title: "YC Instance Group",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
    secondaryIcon: "mdi:group",
  },

  source: {
    package: "@highstate/yandex",
    path: "instance-group",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type Disk = EntityValue<typeof diskEntity>
export type DiskInput = EntityInput<typeof diskEntity>

export type PublicAddress = EntityValue<typeof publicAddressEntity>
export type PublicAddressInput = EntityInput<typeof publicAddressEntity>

export type Image = EntityValue<typeof imageEntity>
export type ImageInput = EntityInput<typeof imageEntity>
