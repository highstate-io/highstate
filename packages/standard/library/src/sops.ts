import { defineUnit, z } from "@highstate/contract"
import { fileEntity } from "./common/files"
import { serverEntity } from "./common/server"

/**
 * Encrypts secrets using SOPS for the specified servers.
 */
export const secrets = defineUnit({
  type: "sops.secrets.v1",

  secrets: {
    /**
     * The content of the SOPS secrets file.
     *
     * Will take precedence over the `data` input.
     */
    data: z.record(z.string(), z.unknown()),
  },

  inputs: {
    servers: {
      entity: serverEntity,
      required: false,
      multiple: true,
    },
    data: {
      entity: fileEntity,
      required: false,
    },
  },

  outputs: {
    file: fileEntity,
  },

  meta: {
    title: "SOPS Secrets",
    icon: "mdi:file-lock",
    category: "Secrets",
  },

  source: {
    package: "@highstate/sops",
    path: "secrets",
  },
})
