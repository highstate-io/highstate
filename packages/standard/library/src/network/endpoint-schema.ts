import { z } from "@highstate/contract"
import { metadataSchema } from "../utils"
import { addressEntity } from "./address"
import { implementationReferenceSchema } from "../impl-ref"

function createEndpointSchema<TLevel extends number, TShape extends z.core.$ZodShape>(
  level: TLevel,
  shape: TShape,
) {
  return z.intersection(
    z.object({
      /**
       * The level of the endpoint in the network stack.
       */
      level: z.literal(level).default(level),

      /**
       * The extra metadata for the endpoint.
       *
       * In most cases, this is provided by the endpoint origin (e.g., a Kubernetes service).
       */
      metadata: z.intersection(
        metadataSchema,
        z.object({
          /**
           * The scope of the endpoint as per IANA definitions.
           *
           * - `private`: The endpoint is intended for use within a private network.
           * - `global`: The endpoint is intended for public access over the internet.
           *
           * If not specified, the scope is considered unknown.
           */
          "iana.scope": z.enum(["private", "global"]).optional(),
        }),
      ),

      /**
       * The implementation reference that will be used to resolve the endpoint at runtime.
       *
       * Used primarily to expose endpoints from private networks to the Pulumi program.
       */
      implRef: implementationReferenceSchema.optional(),

      ...shape,
    }),
    z.union([
      z.object({
        type: z.literal("hostname"),

        /**
         * The hostname of the endpoint in the format of a domain name as per RFC 1035.
         */
        hostname: z.string(),

        address: z.undefined().optional(),
      }),
      z.object({
        type: z.enum(["ipv4", "ipv6"]),

        /**
         * The address entity representing the IP address of the endpoint.
         */
        address: addressEntity.schema,

        hostname: z.undefined().optional(),
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

const onlyl3EndpointSchema = createEndpointSchema(3, {
  port: z.undefined().optional(),
  protocol: z.undefined().optional(),
  appProtocol: z.undefined().optional(),
  path: z.undefined().optional(),
})

const onlyl4EndpointSchema = createEndpointSchema(4, {
  ...l4PortInfoSchema.shape,
  appProtocol: z.undefined().optional(),
  path: z.undefined().optional(),
})

const onlyl7EndpointSchema = createEndpointSchema(7, {
  ...l4PortInfoSchema.shape,
  ...l7AppInfoSchema.shape,
})

export const l3EndpointSchema = z.union([
  onlyl3EndpointSchema,
  onlyl4EndpointSchema,
  onlyl7EndpointSchema,
])

export const l4EndpointSchema = z.union([onlyl4EndpointSchema, onlyl7EndpointSchema])

export const l7EndpointSchema = onlyl7EndpointSchema
