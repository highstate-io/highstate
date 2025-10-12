import type { Simplify } from "type-fest"
import { defineEntity, defineUnit, z } from "@highstate/contract"

export const endpointVisibilitySchema = z.enum([
  "public", // reachable from the public internet
  "external", // reachable from outside the system boundary, but not public
  "internal", // reachable only from within the system or cluster
])

export const endpointFilterSchema = endpointVisibilitySchema.array()

/**
 * The L3 endpoint for some service.
 *
 * May be a domain name or an IP address.
 */
export const l3EndpointEntity = defineEntity({
  type: "network.l3-endpoint.v1",

  schema: z.intersection(
    z.object({
      /**
       * The generic visibility of an endpoint.
       *
       * - `public`: reachable from the public internet;
       * - `external`: reachable from outside the system boundary (e.g., LAN, VPC), but not public;
       * - `internal`: reachable only from within the application or infrastructure boundary (e.g., within a cluster).
       */
      visibility: endpointVisibilitySchema,

      /**
       * The extra metadata for the endpoint.
       *
       * In most cases, this is provided by the endpoint origin (e.g., a Kubernetes service).
       */
      metadata: z.record(z.string(), z.unknown()).optional(),
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
  ),

  meta: {
    color: "#4CAF50",
  },
})

export const l4ProtocolSchema = z.enum(["tcp", "udp"])

/**
 * The schema for a TCP/UDP port.
 */
export const portSchema = z.number().int().min(1).max(65535)

/**
 * The schema for an IPv4 prefix length.
 */
export const ipv4PrefixSchema = z.number().int().min(0).max(32)

/**
 * The schema for address that can be either IPv4 or IPv6.
 */
export const ipv46Schema = z.union([z.ipv4(), z.ipv6()])

export const l4PortInfoSchema = z.object({
  port: portSchema,
  protocol: l4ProtocolSchema,
})

/**
 * The L4 endpoint for some service.
 *
 * Extends an L3 endpoint with a port and protocol.
 */
export const l4EndpointEntity = defineEntity({
  type: "network.l4-endpoint.v1",

  schema: z.intersection(l3EndpointEntity.schema, l4PortInfoSchema),

  meta: {
    color: "#2196F3",
  },
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
  resource: z.string().optional(),
})

/**
 * The L7 endpoint for some service.
 *
 * Extends an L4 endpoint with application protocol information.
 */
export const l7EndpointEntity = defineEntity({
  type: "network.l7-endpoint.v1",

  schema: z.intersection(l4EndpointEntity.schema, l7AppInfoSchema),

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
     * The visibility of the endpoint.
     *
     * The visibility levels are:
     * - `public`: reachable from the public internet;
     * - `external`: reachable from outside the system boundary (e.g., LAN, VPC), but not public;
     * - `internal`: reachable only from within the application or infrastructure boundary (e.g., within a cluster).
     *
     * If not specified, defaults to `public`.
     */
    visibility: endpointVisibilitySchema.default("public"),
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

    /**
     * The visibility of the endpoint.
     *
     * The visibility levels are:
     * - `public`: reachable from the public internet;
     * - `external`: reachable from outside the system boundary (e.g., LAN, VPC), but not public;
     * - `internal`: reachable only from within the application or infrastructure boundary (e.g., within a cluster).
     *
     * If not specified, defaults to `public`.
     */
    visibility: endpointVisibilitySchema.default("public"),
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
     * The possible formats are:
     *
     * - `https://endpoint:port/resource`
     * - `ftp://endpoint:port/resource`
     * - `someotherprotocol://endpoint:port/resource`
     */
    endpoint: z.string(),

    /**
     * The visibility of the endpoint.
     *
     * The visibility levels are:
     * - `public`: reachable from the public internet;
     * - `external`: reachable from outside the system boundary (e.g., LAN, VPC), but not public;
     * - `internal`: reachable only from within the application or infrastructure boundary (e.g., within a cluster).
     *
     * If not specified, defaults to `public`.
     */
    visibility: endpointVisibilitySchema.default("public"),
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

/**
 * Explicitly filter endpoints by their accessibility.
 */
export const endpointFilter = defineUnit({
  type: "network.endpoint-filter.v1",

  args: {
    /**
     * The endpoint filter to filter the endpoints before creating the DNS records.
     *
     * Possible values:
     *
     * - `public`: only endpoints exposed to the public internet;
     * - `external`: reachable from outside the system but not public (e.g., LAN, VPC);
     * - `internal`: reachable only from within the system boundary (e.g., inside a cluster).
     *
     * You can select one or more values.
     *
     * If no value is provided, the endpoints will be filtered by the most accessible type:
     *
     * - if any public endpoints exist, all public endpoints are selected;
     * - otherwise, if any external endpoints exist, all external endpoints are selected;
     * - if neither exist, all internal endpoints are selected.
     */
    endpointFilter: endpointFilterSchema.default([]),
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

/**
 * The generic visibility of an endpoint.
 *
 * - `public`: reachable from the public internet;
 * - `external`: reachable from outside the system boundary (e.g., LAN, VPC), but not public;
 * - `internal`: reachable only from within the application or infrastructure boundary (e.g., within a cluster).
 */
export type EndpointVisibility = z.infer<typeof endpointVisibilitySchema>

/**
 * The list of endpoint visibility levels used to filter endpoints.
 *
 * If empty, it will filter the most widely accessible endpoints, prefering visibility in the following order:
 *   - If any public endpoints exist, all public endpoints are selected.
 *   - Otherwise, if any external endpoints exist, all external endpoints are selected.
 *   - If neither exist, all internal endpoints are selected.
 */
export type EndpointFilter = z.infer<typeof endpointFilterSchema>

export type L3Endpoint = Simplify<z.infer<typeof l3EndpointEntity.schema>>
export type L4Endpoint = Simplify<z.infer<typeof l4EndpointEntity.schema>>
export type L4Protocol = z.infer<typeof l4ProtocolSchema>
export type L4PortInfo = z.infer<typeof l4PortInfoSchema>
export type L7Endpoint = Simplify<z.infer<typeof l7EndpointEntity.schema>>
export type L7AppInfo = z.infer<typeof l7AppInfoSchema>

export const l34EndpointSchema = z.union([
  z.intersection(
    l3EndpointEntity.schema,
    z.object({
      port: z.undefined().optional(),
      protocol: z.undefined().optional(),
    }),
  ),
  l4EndpointEntity.schema,
])

/**
 * The L3 or L4 endpoint for some service.
 *
 * For convenience, L3 case have `port` and `protocol` fields as `undefined`,
 * so you can check any of them to determine if it's an L3 or L4 endpoint.
 */
export type L34Endpoint = Simplify<z.infer<typeof l34EndpointSchema>>
