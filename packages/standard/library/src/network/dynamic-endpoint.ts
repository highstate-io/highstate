import { defineEntity, z } from "@highstate/contract"
import { implementationReferenceSchema } from "../impl-ref"
import { l3EndpointSchema } from "./endpoint-schema"

export type DynamicL3Endpoint = z.infer<typeof dynamicL3EndpointEntity.schema>
export type DynamicL4Endpoint = z.infer<typeof dynamicL4EndpointEntity.schema>
export type DynamicL7Endpoint = z.infer<typeof dynamicL7EndpointEntity.schema>

function defineDynamicEndpointEntity<TLevel extends number, TSchema extends z.ZodType>(
  level: TLevel,
  endpointSchema: TSchema,
) {
  return defineEntity({
    type: `network.dynamic-l${level}-endpoint.v1`,

    schema: z.union([
      z.object({
        type: z.literal("static"),

        /**
         * The static endpoint.
         */
        endpoint: endpointSchema,
      }),
      z.object({
        type: z.literal("dynamic"),

        /**
         * The implementation reference to resolve the dynamic endpoint.
         */
        implRef: implementationReferenceSchema,
      }),
    ]),
  })
}

export const dynamicL3EndpointEntity = defineDynamicEndpointEntity(3, l3EndpointSchema)
export const dynamicL4EndpointEntity = defineDynamicEndpointEntity(4, l3EndpointSchema)
export const dynamicL7EndpointEntity = defineDynamicEndpointEntity(7, l3EndpointSchema)
