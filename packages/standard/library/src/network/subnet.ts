import { defineEntity, z } from "@highstate/contract"

export type Subnet = z.infer<typeof subnetEntity.schema>
export type AddressType = z.infer<typeof addressTypeSchema>

export const addressTypeSchema = z.enum(["ipv4", "ipv6"])

export const subnetEntity = defineEntity({
  type: "network.subnet.v1",

  schema: z.object({
    /**
     * The type of the subnet.
     */
    type: addressTypeSchema,

    /**
     * The canonical base IP address of the subnet.
     */
    baseAddress: z.string(),

    /**
     * The prefix length of the subnet.
     */
    prefixLength: z.number().int().nonnegative(),
  }),

  meta: {
    color: "#3F51B5",
  },
})
