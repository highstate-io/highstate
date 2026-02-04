import type { Simplify } from "type-fest"
import { $args, defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { mapValues, pick } from "remeda"
import { metadataSchema } from "../utils"
import { addressEntity } from "./address"
import {
  dynamicL3EndpointEntity,
  dynamicL4EndpointEntity,
  dynamicL7EndpointEntity,
} from "./dynamic-endpoint"
import {
  l3EndpointSchema,
  l4EndpointSchema,
  type l4PortInfoSchema,
  type l4ProtocolSchema,
  type l7AppInfoSchema,
  l7EndpointSchema,
} from "./endpoint-schema"
import { subnetEntity } from "./subnet"

/**
 * The L3 endpoint for some service.
 *
 * May be a domain name or an IP address.
 */
export const l3EndpointEntity = defineEntity({
  type: "network.l3-endpoint.v1",

  includes: {
    /**
     * The subnet containing the endpoint.
     *
     * If type is "hostname", will be omitted.
     */
    subnet: {
      entity: subnetEntity,
      required: false,
    },

    /**
     * The address of the endpoint.
     *
     * If type is "hostname", will be omitted.
     */
    address: {
      entity: addressEntity,
      required: false,
    },

    /**
     * The dynamic endpoint which statically resolves to this endpoint.
     *
     * Allows to use any static endpoint as a dynamic without extra units.
     */
    dynamic: {
      entity: dynamicL3EndpointEntity,
      required: false,
    },
  },

  schema: l3EndpointSchema,

  meta: {
    color: "#4CAF50",
  },
})

/**
 * The schema for an IPv4 prefix length.
 */
export const ipv4PrefixSchema = z.number().int().min(0).max(32)

/**
 * The schema for address that can be either IPv4 or IPv6.
 */
export const ipv46Schema = z.union([z.ipv4(), z.ipv6()])

/**
 * The L4 endpoint for some service.
 *
 * Extends an L3 endpoint with a port and protocol.
 */
export const l4EndpointEntity = defineEntity({
  type: "network.l4-endpoint.v1",

  extends: { l3EndpointEntity },

  includes: {
    /**
     * The dynamic endpoint which statically resolves to this endpoint.
     *
     * Allows to use any static endpoint as a dynamic without extra units.
     */
    dynamic: dynamicL4EndpointEntity,
  },

  schema: l4EndpointSchema,

  meta: {
    color: "#2196F3",
  },
})

/**
 * The L7 endpoint for some service.
 *
 * Extends an L4 endpoint with application protocol information.
 */
export const l7EndpointEntity = defineEntity({
  type: "network.l7-endpoint.v1",

  extends: { l4EndpointEntity },

  includes: {
    /**
     * The dynamic endpoint which statically resolves to this endpoint.
     *
     * Allows to use any static endpoint as a dynamic without extra units.
     */
    dynamic: dynamicL7EndpointEntity,
  },

  schema: l7EndpointSchema,

  meta: {
    color: "#FF9800",
  },
})

export const endpointArgs = $args({
  /**
   * The custom metadata entries of the endpoint.
   *
   * Can be used to filter them (for example, by environment, region, etc.).
   */
  metadata: metadataSchema,
})

/**
 * The component which creates an L3 endpoint.
 */
export const l3Endpoint = defineUnit({
  type: "network.l3-endpoint.v1",

  args: {
    /**
     * The string representation of the endpoint.
     *
     * May be a domain name or an IP address.
     */
    endpoint: z.string(),

    ...endpointArgs,
  },

  outputs: {
    endpoint: l3EndpointEntity,
  },

  meta: {
    title: "L3 Endpoint",
    icon: "mdi:network-outline",
    iconColor: "#4CAF50",
    defaultNamePrefix: "endpoint",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l3-endpoint",
  },
})

/**
 * The component which creates an L4 endpoint.
 */
export const l4Endpoint = defineUnit({
  type: "network.l4-endpoint.v1",

  args: {
    /**
     * The string representation of the endpoint.
     *
     * May be a domain name or an IP address + port/protocol.
     *
     * The possible formats are:
     *
     * - `endpoint:port` (TCP by default)
     * - `tcp://endpoint:port`
     * - `udp://endpoint:port`
     */
    endpoint: z.string(),

    ...endpointArgs,
  },

  outputs: {
    endpoint: l4EndpointEntity,
  },

  meta: {
    title: "L4 Endpoint",
    icon: "mdi:network-outline",
    iconColor: "#2196F3",
    defaultNamePrefix: "endpoint",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l4-endpoint",
  },
})

/**
 * The component which creates an L7 endpoint.
 */
export const l7Endpoint = defineUnit({
  type: "network.l7-endpoint.v1",

  args: {
    /**
     * The string representation of the endpoint.
     *
     * The format is `[protocol://]endpoint[:port][/path]`.
     */
    endpoint: z.string(),

    /**
     * The L4 protocol of the endpoint.
     *
     * If not specified, it will be inferred from the endpoint string if possible or default to `tcp`.
     */
    protocol: z.enum(["infer", "tcp", "udp"]).default("infer"),

    ...endpointArgs,
  },

  outputs: {
    endpoint: l7EndpointEntity,
  },

  meta: {
    title: "L7 Endpoint",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
    defaultNamePrefix: "endpoint",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/l7-endpoint",
  },
})

export const networkArgs = $args({
  /**
   * The filter expression to select endpoints by their properties and metadata.
   *
   * The following properties are available for filtering:
   *
   * - `type`: The type of the endpoint (`ipv4`, `ipv6`, `hostname`).
   * - `level`: The level of the endpoint in the network stack (`3`, `4`, `7`). Numeric, can be used in expressions like `level >= 4`.
   * - `protocol`: The L4 protocol of the endpoint (`tcp`, `udp`). Only available for L4 and L7 endpoints.
   * - `port`: The port of the endpoint. Only available for L4 and L7 endpoints.
   * - `appProtocol`: The application protocol of the endpoint (e.g., `http`, `https`, `dns`). Only available for L7 endpoints.
   * - `metadata.{key}`: Any custom metadata field added to the endpoint. Nested fields (e.g., `metadata.k8s.service.clusterId`) are supported.
   *
   * See [filter-expression](https://github.com/tronghieu/filter-expression?tab=readme-ov-file#language) for more details on the expression syntax.
   */
  endpointFilter: z.string().meta({ language: "javascript" }),
})

export const optionalNetworkArgs = mapValues(networkArgs, x => ({ schema: x.schema.optional() }))

/**
 * Explicitly filter endpoints by their accessibility.
 */
export const endpointFilter = defineUnit({
  type: "network.endpoint-filter.v1",

  args: {
    ...pick(networkArgs, ["endpointFilter"]),
  },

  inputs: {
    l3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
      required: false,
    },
    l4Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
    l7Endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    l3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },
    l4Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
    l7Endpoints: {
      entity: l7EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Endpoint Filter",
    icon: "mdi:network-outline",
    iconColor: "#FF9800",
    secondaryIcon: "mdi:filter-outline",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/network/endpoint-filter",
  },
})

export type L3Endpoint = Simplify<z.infer<typeof l3EndpointEntity.schema>>
export type L3EndpointInput = EntityInput<typeof l3EndpointEntity>
export type L4Endpoint = Simplify<z.infer<typeof l4EndpointEntity.schema>>
export type L4EndpointInput = EntityInput<typeof l4EndpointEntity>
export type L4Protocol = z.infer<typeof l4ProtocolSchema>
export type L4PortInfo = z.infer<typeof l4PortInfoSchema>
export type L7Endpoint = Simplify<z.infer<typeof l7EndpointEntity.schema>>
export type L7EndpointInput = EntityInput<typeof l7EndpointEntity>
export type L7AppInfo = z.infer<typeof l7AppInfoSchema>

export type EndpointLevel = L3Endpoint["level"]

export type EndpointByMinLevel<TMinLevel extends EndpointLevel> = {
  3: L3Endpoint
  4: L4Endpoint
  7: L7Endpoint
}[TMinLevel]
