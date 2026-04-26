import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  z,
} from "@highstate/contract"
import { subnetEntity } from "./subnet"

export type AddressSpace = EntityValue<typeof addressSpaceEntity>
export type AddressSpaceInput = EntityInput<typeof addressSpaceEntity>

/**
 * The entity representing a network address space.
 */
export const addressSpaceEntity = defineEntity({
  type: "network.address-space.v1",

  includes: {
    /**
     * The minimal set of subnets that fully cover the address space.
     */
    subnets: {
      entity: subnetEntity,
      multiple: true,
      required: false,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#3F51B5",
    title: "Address Space",
    icon: "mdi:network",
    iconColor: "#3F51B5",
  },
})

/**
 * Defines an address space from a list of addresses/subnets/ranges.
 */
export const addressSpace = defineUnit({
  type: "network.address-space.v1",

  args: {
    /**
     * The list of addresses to include in the address space.
     *
     * The supported formats are:
     * - Single IP address (e.g., `192.168.1.1`);
     * - CIDR notation (e.g., `192.168.1.1/24`);
     * - Dash notation (e.g., `192.168.1.1-192.168.1.254`).
     *
     * The addresses can be a mix of IPv4 and IPv6.
     */
    included: z.string().array().default([]),

    /**
     * The list of addresses to exclude from the `addresses` list.
     *
     * The supported formats are the same as in `addresses`.
     */
    excluded: z.string().array().default([]),

    /**
     * Whether to return IPv4 subnets or filter them out.
     *
     * By default, is set to `true`.
     */
    ipv4: z.boolean().default(true),

    /**
     * Whether to return IPv6 subnets or filter them out.
     *
     * By default, is set to `true`.
     */
    ipv6: z.boolean().default(true),
  },

  inputs: {
    /**
     * The subnets to include in the address space.
     */
    included: {
      entity: subnetEntity,
      multiple: true,
      required: false,
    },

    /**
     * The subnets to exclude from the `included` list.
     */
    excluded: {
      entity: subnetEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    /**
     * The address space entity representing the created address space.
     */
    addressSpace: addressSpaceEntity,
  },

  meta: {
    title: "Address Space",
    icon: "mdi:network",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/address-space",
  },
})
