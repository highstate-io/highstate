import { defineEntity, z } from "@highstate/contract"
import { addressTypeSchema, subnetEntity } from "./subnet"

export type Address = z.infer<typeof addressEntity.schema>

export const addressEntity = defineEntity({
  type: "network.address.v1",

  includes: {
    /**
     * The subnet to which the address belongs.
     */
    subnet: subnetEntity,
  },

  schema: z.object({
    /**
     * The type of the address.
     */
    type: addressTypeSchema,

    /**
     * The address in canonical string representation.
     *
     * IPv6 addresses must be in shortest possible notation as per RFC 5952.
     *
     * For example:
     * - IPv4: `192.168.1.1`
     * - IPv6: `2001:db8:85a3::8a2e:370:7334`
     */
    value: z.string(),
  }),
})
