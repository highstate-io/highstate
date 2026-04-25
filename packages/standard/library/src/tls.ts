import { defineEntity, z } from "@highstate/contract"
import { fileEntity } from "./common"

export const certificateEntity = defineEntity({
  type: "tls.certificate.v1",

  includes: {
    /**
     * The file containing the certificate in PEM format.
     */
    file: fileEntity,
  },

  schema: z.unknown(),

  meta: {
    title: "TLS Certificate",
    color: "#4caf50",
    icon: "mdi:certificate",
    iconColor: "#4caf50",
  },
})
