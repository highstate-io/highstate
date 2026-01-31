import { defineEntity, defineUnit, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { toPatchArgs } from "../utils"

const etcdArgs = {
  endpoints: {
    schema: z.string().array().default([]),
  },
}

/**
 * Represents the etcd database instance.
 */
export const etcdEntity = defineEntity({
  type: "databases.etcd.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#0064bf",
  },
})

/**
 * The existing etcd database instance.
 */
export const existingEtcd = defineUnit({
  type: "databases.etcd.existing.v1",

  args: etcdArgs,

  inputs: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    etcd: etcdEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/existing-etcd",
  },

  meta: {
    title: "Existing etcd Database",
    icon: "simple-icons:etcd",
    secondaryIcon: "mdi:database",
    category: "Databases",
  },
})

/**
 * Patches some properties of the etcd database and outputs the updated database.
 */
export const etcdPatch = defineUnit({
  type: "databases.etcd-patch.v1",

  args: toPatchArgs(etcdArgs),

  inputs: {
    etcd: etcdEntity,

    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    etcd: etcdEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/databases/etcd-patch",
  },

  meta: {
    title: "etcd Patch",
    icon: "simple-icons:etcd",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Databases",
  },
})
