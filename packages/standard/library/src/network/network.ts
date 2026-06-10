import { defineEntity, defineUnit, z } from "@highstate/contract"
import { entityMetaArgsSchema } from "../utils"
import { addressSpaceEntity } from "./address-space"

export const networkEntity = defineEntity({
  type: "network.v1",

  schema: z.unknown(),

  extends: { addressSpaceEntity },
})

export const network = defineUnit({
  type: "network.v1",

  args: {
    /**
     * The custom identity string of the network.
     * Will be used to generate its ID which itself will be used to compare network entities.
     *
     * If not provided, the ID of the unit state will be used as identity string.
     */
    identity: z.string().optional(),

    /**
     * The subnets that belong to the network.
     */
    subnets: z.string().array().default([]),

    /**
     * The custom meta for the network entity.
     */
    entityMeta: entityMetaArgsSchema,
  },

  inputs: {
    /**
     * The subnets that belong to the network.
     */
    subnets: {
      entity: networkEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    /**
     * The network entity itself.
     */
    network: networkEntity,
  },

  source: {
    package: "@highstate/common",
    path: "units/network/network",
  },
})
