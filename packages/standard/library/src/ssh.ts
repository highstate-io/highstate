import {
  $inputs,
  $secrets,
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { l4EndpointEntity, portSchema } from "./network"

export const keyTypeSchema = z.enum(["ed25519"])

export const publicKeyEntity = defineEntity({
  type: "ssh.public-key.v1",

  schema: z.object({
    /**
     * The type of the SSH key.
     *
     * For now, only `ed25519` is supported.
     */
    type: keyTypeSchema,

    /**
     * The public key in OpenSSH format.
     */
    publicKey: z.string(),

    /**
     * The fingerprint of the SSH key.
     */
    fingerprint: z.string(),
  }),

  meta: {
    color: "#2b5797",
  },
})

/**
 * The entity representing an SSH key pair.
 */
export const keyPairEntity = defineEntity({
  type: "ssh.key-pair.v1",

  extends: { publicKeyEntity },

  schema: z.object({
    /**
     * The private key in PEM format.
     */
    privateKey: secretSchema(z.string()),
  }),

  meta: {
    color: "#2b5797",
    title: "SSH Key Pair",
    icon: "charm:key",
    iconColor: "#ffffff",
    secondaryIcon: "mdi:lock",
    secondaryIconColor: "#ffffff",
  },
})

/**
 * The schema for the SSH connection credentials.
 */
export const connectionEntity = defineEntity({
  type: "ssh.connection.v1",

  includes: {
    /**
     * The endpoints to connect to.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },

    /**
     * The SSH key pair to use for authentication.
     */
    keyPair: {
      entity: keyPairEntity,
      required: false,
    },
  },

  schema: z.object({
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
    password: secretSchema(z.string()).optional(),
  }),

  meta: {
    color: "#2b5797",
    title: "SSH Connection",
    icon: "mdi:terminal",
    iconColor: "#2b5797",
  },
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
   * The SSH key pair to use for authentication by Highstate.
   */
  sshKeyPair: {
    entity: keyPairEntity,
    required: false,
  },

  /**
   * The extra SSH public keys to add to the server's `authorized_keys` file.
   *
   * Will not (and cannot) be used for authentication by Highstate.
   */
  sshPublicKeys: {
    entity: publicKeyEntity,
    required: false,
    multiple: true,
  },
})

/**
 * Provides existing SSH public key.
 */
export const publicKey = defineUnit({
  type: "ssh.public-key.v1",

  args: {
    /**
     * The public key in OpenSSH format.
     */
    publicKey: z.string().meta({ multiline: true }),
  },

  outputs: {
    publicKey: publicKeyEntity,
  },

  meta: {
    title: "SSH Public Key",
    category: "ssh",
    icon: "charm:key",
    iconColor: "#ffffff",
    secondaryIcon: "mdi:lock-open",
    secondaryIconColor: "#ffffff",
  },

  source: {
    package: "@highstate/common",
    path: "units/ssh/public-key",
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
export type PublicKey = EntityValue<typeof publicKeyEntity>
export type KeyPair = EntityValue<typeof keyPairEntity>
export type Connection = EntityValue<typeof connectionEntity>

export type PublicKeyInput = EntityInput<typeof publicKeyEntity>
export type KeyPairInput = EntityInput<typeof keyPairEntity>
