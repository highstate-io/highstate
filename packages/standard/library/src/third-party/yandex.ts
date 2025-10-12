import { defineEntity, defineUnit, z } from "@highstate/contract"
import { serverOutputs, vmSecrets, vmSshArgs } from "../common"
import { ipv4PrefixSchema, ipv46Schema } from "../network"
import * as ssh from "../ssh"

export const cloudEntity = defineEntity({
  type: "yandex.cloud.v0",

  schema: z.object({
    token: z.string().optional(),
    serviceAccountKeyFile: z.string().optional(),
    cloudId: z.string(),
    defaultFolderId: z.string(),
    defaultZone: z.string(),
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
  type: "yandex.connection.v0",

  args: {
    /**
     * The availability zone for resources.
     */
    defaultZone: z.string().default("ru-central1-d"),

    /**
     * The region ID for resources.
     */
    regionId: z.string().default("ru-central1"),
  },

  secrets: {
    /**
     * The service account key file content (JSON).
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
    yandexCloud: cloudEntity,
  },

  meta: {
    title: "Yandex Cloud Connection",
    category: "Yandex Cloud",
    icon: "simple-icons:yandexcloud",
    iconColor: "#0080ff",
  },

  source: {
    package: "@highstate/yandex",
    path: "connection",
  },
})

/**
 * The virtual machine on Yandex Cloud.
 */
export const virtualMachine = defineUnit({
  type: "yandex.virtual-machine.v0",

  args: {
    /**
     * The platform ID for the instance.
     */
    platformId: z.string().default("standard-v3"),

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
         * The core fraction (10-100).
         */
        coreFraction: z.number().min(10).max(100).optional(),
      })
      .prefault({}),

    /**
     * The boot disk configuration.
     */
    disk: z
      .object({
        /**
         * The disk size in GB.
         *
         * For `network-ssd-nonreplicated` must be multiple of 93.
         */
        size: z.number().default(20),

        /**
         * The disk type.
         */
        type: z.string().default("network-ssd-nonreplicated"),

        /**
         * The image family to use.
         */
        imageFamily: z.string().default("ubuntu-2204-lts"),
      })
      .prefault({}),

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
         * The list of DNS servers.
         */
        dns: ipv46Schema.array().default([]),
      })
      .prefault({}),

    /**
     * The IPv4 address configuration.
     */
    ipv4: z
      .discriminatedUnion("type", [
        z.object({
          type: z.literal("dhcp"),
        }),
        z.object({
          type: z.literal("static"),
          address: z.string(),
          prefix: ipv4PrefixSchema.default(24),
          gateway: z.string().optional(),
        }),
      ])
      .default({ type: "dhcp" }),

    /**
     * The SSH configuration.
     */
    ssh: vmSshArgs,

    /**
     * Additional metadata for cloud-init.
     */
    metadata: z.record(z.string(), z.string()).default({}),
  },

  secrets: {
    ...vmSecrets,
  },

  inputs: {
    yandexCloud: cloudEntity,
    ...ssh.inputs,
  },

  outputs: serverOutputs,

  meta: {
    title: "Yandex Cloud Virtual Machine",
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

export type Cloud = z.infer<typeof cloudEntity.schema>
