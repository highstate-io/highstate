import { defineEntity, defineUnit, z } from "@highstate/contract"
import { serverOutputs, vmSecrets, vmSshArgs } from "../common"
import * as ssh from "../ssh"

export const connectionEntity = defineEntity({
  type: "yandex.connection.v1",

  schema: z.object({
    /**
     * The service account key file content (JSON).
     */
    serviceAccountKeyFile: z.string().optional(),

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
  }),

  meta: {
    color: "#0080ff",
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
            .enum(["ru-central1-a", "ru-central1-b", "ru-central1-d"])
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
     * The service account key file content (JSON).
     *
     * Important: service account must have `iam.serviceAccounts.user` role to work properly.
     *
     * See [Creating an authorized key](https://yandex.cloud/en/docs/iam/operations/authentication/manage-authorized-keys#create-authorized-key) for details.
     */
    serviceAccountKeyFile: {
      schema: z.string().meta({ language: "json" }),
      meta: {
        title: "Service Account Key File",
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

export const imageEntity = defineEntity({
  type: "yandex.image.v1",

  schema: z.object({
    /**
     * The global ID of the image.
     */
    id: z.string(),
  }),

  meta: {
    title: "Yandex Cloud Image",
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
     * The platform ID for the instance.
     *
     * See [Platforms](https://yandex.cloud/en/docs/compute/concepts/vm-platforms) for details.
     */
    platformId: z
      .enum([
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
      .default("standard-v3"),

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
        coreFraction: z.number().min(10).max(100).optional(),
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

export type Connection = z.infer<typeof connectionEntity.schema>
