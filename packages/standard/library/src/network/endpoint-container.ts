import {
  $args,
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  z,
} from "@highstate/contract"
import { pick } from "remeda"
import { addressEntity } from "./address"
import {
  l3EndpointEntity,
  l4EndpointEntity,
  l7EndpointEntity,
  optionalNetworkArgs,
} from "./endpoint"

export const l3EndpointContainer = defineEntity({
  type: "network.l3-endpoint-container.v1",

  includes: {
    endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#4CAF50",
    title: "L3 Endpoint Container",
    icon: "mdi:network-outline",
    iconColor: "#4CAF50",
  },
})

export const l4EndpointContainer = defineEntity({
  type: "network.l4-endpoint-container.v1",

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#2196F3",
    title: "L4 Endpoint Container",
    icon: "mdi:network-outline",
    iconColor: "#2196F3",
  },
})

export const l7EndpointContainer = defineEntity({
  type: "network.l7-endpoint-container.v1",

  includes: {
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#FF9800",
    title: "L7 Endpoint Container",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
  },
})

const endpointReplacerArgs = $args({
  /**
   * The strings to parse as endpoints and add to the replacement list.
   */
  endpoints: z.string().array().default([]),

  /**
   * Whether to add current endpoints of the entity to the replacement list.
   *
   * Defaults to `true`.
   */
  includeCurrent: z.boolean().default(true),

  ...pick(optionalNetworkArgs, ["endpointFilter"]),
})

/**
 * Replaces the L3 endpoints in the entity.
 */
export const l3EndpointReplacer = defineUnit({
  type: "network.l3-endpoint-replacer.v1",

  args: endpointReplacerArgs,

  inputs: {
    /**
     * The entity containing the "endpoints" inclusion to replace.
     */
    entity: l3EndpointContainer,

    /**
     * The endpoints to add to the replacement list.
     */
    endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The IP addresses to parse as endpoints and add to the replacement list.
     */
    addresses: {
      entity: addressEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    entity: { fromInput: "entity" },
  },

  meta: {
    title: "L3 Endpoint Replacer",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
    secondaryIcon: "mdi:swap-horizontal-bold",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l3-endpoint-replacer",
  },
})

/**
 * Replaces the L4 endpoints in the entity.
 */
export const l4EndpointReplacer = defineUnit({
  type: "network.l4-endpoint-replacer.v1",

  args: endpointReplacerArgs,

  inputs: {
    /**
     * The entity containing the "endpoints" inclusion to replace.
     */
    entity: l4EndpointContainer,

    /**
     * The endpoints to add to the replacement list.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    entity: { fromInput: "entity" },
  },

  meta: {
    title: "L4 Endpoint Replacer",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
    secondaryIcon: "mdi:swap-horizontal-bold",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l4-endpoint-replacer",
  },
})

/**
 * Replaces the L7 endpoints in the entity.
 */
export const l7EndpointReplacer = defineUnit({
  type: "network.l7-endpoint-replacer.v1",

  args: endpointReplacerArgs,

  inputs: {
    /**
     * The entity containing the "endpoints" inclusion to replace.
     */
    entity: l7EndpointContainer,

    /**
     * The endpoints to add to the replacement list.
     */
    endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    entity: { fromInput: "entity" },
  },

  meta: {
    title: "L7 Endpoint Replacer",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
    secondaryIcon: "mdi:swap-horizontal-bold",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l7-endpoint-replacer",
  },
})

export type L3EndpointContainer = EntityValue<typeof l3EndpointContainer>
export type L4EndpointContainer = EntityValue<typeof l4EndpointContainer>
export type L7EndpointContainer = EntityValue<typeof l7EndpointContainer>

export type L3EndpointContainerInput = EntityInput<typeof l3EndpointContainer>
export type L4EndpointContainerInput = EntityInput<typeof l4EndpointContainer>
export type L7EndpointContainerInput = EntityInput<typeof l7EndpointContainer>
