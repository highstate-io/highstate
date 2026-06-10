import { defineEntity, secretSchema, z } from "@highstate/contract"
import { certificateEntity } from "../tls"

export const credentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("token"),

    /**
     * The static token used to authenticate against Vault.
     */
    token: secretSchema(z.string()),
  }),
])

/**
 * Represents a connection to a Vault instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "vault.connection.v1",

  includes: {
    /**
     * The TLS certificate of the server if any.
     */
    certificate: {
      entity: certificateEntity,
      required: false,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the Vault instance.
     */
    credentials: credentialsSchema,
  }),

  meta: {
    color: "#000000",
  },
})
