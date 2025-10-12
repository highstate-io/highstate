import { $inputs, $secrets, defineEntity, defineUnit, z } from "@highstate/contract"
import { fileEntity } from "./common/files"
import { l4EndpointEntity, portSchema } from "./network"

export const keyTypeSchema = z.enum(["ed25519"])

/**
 * The entity representing an SSH key pair.
 */
export const keyPairEntity = defineEntity({
  type: "ssh.key-pair.v1",

  schema: z.object({
    /**
     * The type of the SSH key.
     *
     * For now, only `ed25519` is supported.
     */
    type: keyTypeSchema,

    /**
     * The fingerprint of the SSH key.
     */
    fingerprint: z.string(),

    /**
     * The public key in OpenSSH format.
     */
    publicKey: z.string(),

    /**
     * The private key in PEM format.
     */
    privateKey: z.string(),
  }),

  meta: {
    color: "#2b5797",
  },
})

/**
 * The schema for the SSH connection configuration.
 *
 * Contains enough information to connect to an SSH server.
 */
export const connectionSchema = z.object({
  /**
   * The list of L4 endpoints which can be used to connect to the SSH server.
   */
  endpoints: l4EndpointEntity.schema.array(),

  /**
   * The host key of the SSH server which will be used to verify the server's identity.
   */
  hostKey: z.string(),

  /**
   * The user to connect as.
   */
  user: z.string(),

  /**
   * The password to use for authentication.
   */
  password: z.string().optional(),

  /**
   * The SSH key pair to use for authentication.
   */
  keyPair: keyPairEntity.schema.optional(),
})

export const argsSchema = z.object({
  /**
   * Whether the SSH is enabled on the server.
   *
   * If set to `false`, all SSH-related functionality will be disabled.
   */
  enabled: z.boolean().default(true),

  /**
   * The alternate host to connect to.
   */
  host: z.string().optional(),

  /**
   * The SSH port to connect to.
   */
  port: portSchema.default(22),

  /**
   * The SSH user to connect as.
   */
  user: z.string().default("root"),
})

export const secrets = $secrets({
  /**
   * The SSH private key in PEM format.
   */
  sshPrivateKey: z.string().optional().meta({ multiline: true }),

  /**
   * The SSH password to use for authentication.
   */
  sshPassword: z.string().optional(),
})

export const inputs = $inputs({
  /**
   * The SSH key pair to use for authentication.
   */
  sshKeyPair: {
    entity: keyPairEntity,
    required: false,
  },
})

/**
 * Holds the ED25519 SSH key pair and generates the private key if not provided.
 */
export const keyPair = defineUnit({
  type: "ssh.key-pair.v1",

  secrets: {
    /**
     * The SSH private key in PEM format.
     *
     * If not provided, a new key pair will be generated and stored.
     */
    privateKey: z.string().optional().meta({ multiline: true }),
  },

  outputs: {
    keyPair: keyPairEntity,
    publicKeyFile: fileEntity,
  },

  meta: {
    title: "SSH Key Pair",
    category: "ssh",
    icon: "charm:key",
    iconColor: "#ffffff",
    secondaryIcon: "mdi:lock",
    secondaryIconColor: "#ffffff",
  },

  source: {
    package: "@highstate/common",
    path: "units/ssh/key-pair",
  },
})

export type Args = z.infer<typeof argsSchema>
export type KeyType = z.infer<typeof keyTypeSchema>
export type KeyPair = z.infer<typeof keyPairEntity.schema>
export type Connection = z.infer<typeof connectionSchema>
