import { defineUnit, objectEntity, z } from "@highstate/contract"

/**
 * A unit that filters entities based on a specified expression.
 */
export const filter = defineUnit({
  type: "common.filter.v1",

  args: {
    /**
     * The expression used to filter entities.
     */
    expression: z.string(),
  },

  inputs: {
    entities: {
      entity: objectEntity,
      multiple: true,
    },
  },

  outputs: {
    entities: {
      fromInput: "entities",
      multiple: true,
    },
  },

  meta: {
    title: "Entity Filter",
    category: "common",
    icon: "mdi:filter-variant",
  },

  source: {
    package: "@highstate/common",
    path: "filter",
  },
})
