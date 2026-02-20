import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"

/**
 * Represents an etcd cluster with endpoints to access it.
 */
export const clusterEntity = defineEntity({
  type: "etcd.cluster.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * The name of the etcd cluster.
     */
    name: z.string(),
  }),

  meta: {
    color: "#0064bf",
  },
})

/**
 * The existing etcd cluster hosted on one or multiple servers.
 */
export const existingCluster = defineUnit({
  type: "etcd.cluster.existing.v1",

  args: {
    /**
     * The name of the existing etcd cluster.
     */
    clusterName: z.string(),

    /**
     * The endpoints to connect to the etcd cluster.
     */
    endpoints: z.string().array().default([]),
  },

  inputs: {
    /**
     * The endpoints to connect to the etcd cluster.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    cluster: clusterEntity,
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

export type Cluster = z.infer<typeof clusterEntity.schema>
export type ClusterInput = EntityInput<typeof clusterEntity>
