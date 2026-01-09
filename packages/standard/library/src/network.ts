import type { Simplify } from "type-fest"
import { $args, defineEntity, defineUnit, z } from "@highstate/contract"
import { mapValues, pick } from "remeda"
import { commonArgsSchema } from "./utils"

export function createEndpointSchema<TLevel extends number, TShape extends z.core.$ZodShape>(
  level: TLevel,
  shape: TShape,
) {
  return z.intersection(
    z.object({
      /**
       * The level of the endpoint in the network stack.
       */
      level: z.literal(level).default(level),

      ...pick(commonArgsSchema, ["labels"]),

      /**
       * The extra metadata for the endpoint.
       *
       * In most cases, this is provided by the endpoint origin (e.g., a Kubernetes service).
       */
      metadata: z.record(z.string(), z.unknown()).optional(),

      ...shape,
    }),
    z.union([
      z.object({
        type: z.literal("hostname"),

        /**
         * The hostname of the endpoint in the format of a domain name.
         */
        hostname: z.string(),
      }),
      z.object({
        type: z.literal("ipv4"),

        /**
         * The IPv4 address of the endpoint.
         */
        address: z.string(),
      }),
      z.object({
        type: z.literal("ipv6"),

        /**
         * The IPv6 address of the endpoint.
         */
        address: z.string(),
      }),
    ]),
  )
}

export const l4ProtocolSchema = z.enum(["tcp", "udp"])

/**
 * The schema for a TCP/UDP port.
 */
export const portSchema = z.number().int().min(1).max(65535)

export const l4PortInfoSchema = z.object({
  port: portSchema,
  protocol: l4ProtocolSchema,
})

export const l7AppInfoSchema = z.object({
  /**
   * The name of the application protocol used by the endpoint.
   */
  appProtocol: z.string(),

  /**
   * The resource path of the application endpoint, including query parameters.
   * Must not start with a slash (`/`).
   *
   * Example: `api/v1/resource?query=value`, `database?param=value`, `user/repo.git`.
   */
  path: z.string().optional(),
})

const l3EndpointSchema = createEndpointSchema(3, {})
const l4EndpointSchema = createEndpointSchema(4, l4PortInfoSchema.shape)

const l7EndpointSchema = createEndpointSchema(7, {
  ...l4PortInfoSchema.shape,
  ...l7AppInfoSchema.shape,
})

const endpointSchema = z.union([l3EndpointSchema, l4EndpointSchema, l7EndpointSchema])

/**
 * The L3 endpoint for some service.
 *
 * May be a domain name or an IP address.
 */
export const l3EndpointEntity = defineEntity({
  type: "network.l3-endpoint.v1",

  schema: endpointSchema,

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

  schema: z.intersection(
    endpointSchema,
    z.object({ level: z.union([z.literal(4), z.literal(7)]) }),
  ),

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

  schema: z.intersection(endpointSchema, z.object({ level: z.literal(7) })),

  meta: {
    color: "#FF9800",
  },
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

    /**
     * The custom tags of the endpoint.
     *
     * Can be used to filter them (for example, by visibility).
     */
    tags: z.string().array().default([]),
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
     * The custom tags of the endpoint.
     *
     * Can be used to filter them (for example, by visibility).
     */
    tags: z.string().array().default([]),
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
   * The filter expression to select endpoints by their properties and tags.a
   *
   * Besides the labels, the following additional labels are available for filtering:
   *
   * - `type`: The type of the endpoint (`ipv4`, `ipv6`, `hostname`).
   * - `level`: The level of the endpoint in the network stack (`3`, `4`, `7`). Numeric, can be used in expressions like `level >= 4`.
   * - `protocol`: The L4 protocol of the endpoint (`tcp`, `udp`). Only available for L4 and L7 endpoints.
   * - `port`: The port of the endpoint. Only available for L4 and L7 endpoints.
   * - `appProtocol`: The application protocol of the endpoint (e.g., `http`, `https`, `dns`). Only available for L7 endpoints.
   *
   * See [filter-expression](https://github.com/tronghieu/filter-expression?tab=readme-ov-file#language) for more details on the expression syntax.
   */
  endpointFilter: z.string().meta({ language: "javascript" }),
})

export const optionalNetworkArgs = mapValues(networkArgs, x => ({ schema: x.schema.optional() }))

const endpointManipulation = {
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
} as const

/**
 * Explicitly filter endpoints by their accessibility.
 */
export const endpointFilter = defineUnit({
  type: "network.endpoint-filter.v1",

  args: {
    ...pick(networkArgs, ["endpointFilter"]),
  },

  ...endpointManipulation,

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
export type L4Endpoint = Simplify<z.infer<typeof l4EndpointEntity.schema>>
export type L4Protocol = z.infer<typeof l4ProtocolSchema>
export type L4PortInfo = z.infer<typeof l4PortInfoSchema>
export type L7Endpoint = Simplify<z.infer<typeof l7EndpointEntity.schema>>
export type L7AppInfo = z.infer<typeof l7AppInfoSchema>

export type EndpointLevel = L3Endpoint["level"]

export type EndpointByMinLevel<TMinLevel extends EndpointLevel> = {
  3: L3Endpoint
  4: L4Endpoint
  7: L7Endpoint
}[TMinLevel]
