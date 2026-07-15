import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { fileEntity } from "../common"
import { l7EndpointContainer } from "../network"
import { privateKeySchema } from "../tls"

const vaultColor = "#6F5CFF"
const vaultIcon = "simple-icons:vault"

export const credentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("token"),

    /**
     * The static token used to authenticate against Vault.
     */
    token: secretSchema(z.string()),
  }),

  z.object({
    type: z.literal("approle"),

    /**
     * The path where the AppRole auth backend is mounted.
     */
    authPath: z.string(),

    /**
     * The role ID used to authenticate against Vault.
     */
    roleId: z.string(),

    /**
     * The secret ID used to authenticate against Vault.
     */
    secretId: secretSchema(z.string()),
  }),
])

/**
 * Represents a connection to a Vault instance, including the endpoints and credentials.
 */
export const connectionEntity = defineEntity({
  type: "vault.connection.v1",

  extends: { l7EndpointContainer },

  includes: {
    /**
     * The CA certificate file used to verify the server if any.
     */
    ca: {
      entity: fileEntity,
      required: false,
    },
  },

  schema: z.object({
    /**
     * The credentials for authenticating to the Vault instance.
     */
    credentials: credentialsSchema,

    /**
     * The Vault Enterprise namespace to operate in.
     */
    namespace: z.string().optional(),

    /**
     * The TLS server name used to verify the Vault server certificate.
     */
    tlsServerName: z.string().optional(),
  }),

  meta: {
    color: vaultColor,
    title: "Vault Connection",
    icon: vaultIcon,
    iconColor: vaultColor,
  },
})

export const pkiCaEntity = defineEntity({
  type: "vault.pki.ca.v1",

  includes: {
    /**
     * The Vault connection authorized to manage this PKI CA.
     */
    connection: {
      entity: connectionEntity,
    },

    /**
     * The root CA certificate in PEM format.
     */
    ca: {
      entity: fileEntity,
    },
  },

  schema: z.object({
    /**
     * The mount path of the root PKI backend.
     */
    path: z.string(),

    /**
     * The mount path of the intermediate PKI backend used by issuers.
     */
    intermediatePath: z.string(),

    /**
     * The common name of the root CA certificate.
     */
    commonName: z.string(),
  }),

  meta: {
    color: vaultColor,
    title: "Vault PKI CA",
    icon: vaultIcon,
    iconColor: vaultColor,
  },
})

export const pkiIssuerEntity = defineEntity({
  type: "vault.pki.issuer.v1",

  includes: {
    /**
     * The Vault connection authorized to issue certificates through this PKI issuer.
     */
    connection: {
      entity: connectionEntity,
    },
  },

  schema: z.object({
    /**
     * The mount path of the shared intermediate PKI backend.
     */
    path: z.string(),

    /**
     * The PKI role name used to issue leaf certificates.
     */
    roleName: z.string(),

    /**
     * The DNS zones for which this issuer can issue certificates.
     */
    dnsNames: z.string().array(),

    /**
     * The common names for which this issuer can issue certificates.
     */
    commonNames: z.string().array(),

    /**
     * Whether the Vault role allows issuing certificates for exact allowed domains.
     */
    allowBareDomains: z.boolean(),

    /**
     * Whether the Vault role allows issuing certificates for subdomains of allowed domains.
     */
    allowSubdomains: z.boolean(),

    /**
     * Whether the Vault role allows issuing wildcard certificates.
     */
    allowWildcardCertificates: z.boolean(),
  }),

  meta: {
    color: vaultColor,
    title: "Vault PKI Issuer",
    icon: vaultIcon,
    iconColor: vaultColor,
  },
})

/**
 * Creates a root PKI CA in Vault.
 */
export const pkiCa = defineUnit({
  type: "vault.pki.ca.v1",

  args: {
    /**
     * The mount path of the root PKI backend.
     *
     * If not provided, it will be set to `pki/<unit name>`.
     */
    path: z.string().optional(),

    /**
     * The common name of the root CA certificate.
     *
     * If not provided, it will be set to `<unit name> Root CA`.
     */
    commonName: z.string().optional(),

    /**
     * The TTL of the generated root CA certificate.
     */
    ttl: z.string().default("87600h"),

    /**
     * The private key configuration for the root CA certificate.
     */
    privateKey: privateKeySchema,

    /**
     * The default lease TTL of the root PKI backend in seconds.
     */
    defaultLeaseTtlSeconds: z.number().int().positive().default(3600),

    /**
     * The maximum lease TTL of the root PKI backend in seconds.
     */
    maxLeaseTtlSeconds: z.number().int().positive().default(315360000),

    /**
     * The intermediate PKI backend and CA certificate configuration.
     */
    intermediate: z
      .object({
        /**
         * The mount path of the intermediate PKI backend used by issuers.
         *
         * If not provided, it will be set to `<root path>-intermediate`.
         */
        path: z.string().optional(),

        /**
         * The common name of the intermediate CA certificate.
         *
         * If not provided, it will be set to `<unit name> Intermediate CA`.
         */
        commonName: z.string().optional(),

        /**
         * The TTL of the generated intermediate CA certificate.
         */
        ttl: z.string().default("43800h"),

        /**
         * The private key configuration for the intermediate CA certificate.
         */
        privateKey: privateKeySchema,

        /**
         * The default lease TTL of the intermediate PKI backend in seconds.
         */
        defaultLeaseTtlSeconds: z.number().int().positive().default(3600),

        /**
         * The maximum lease TTL of the intermediate PKI backend in seconds.
         */
        maxLeaseTtlSeconds: z.number().int().positive().default(157680000),
      })
      .default({
        ttl: "43800h",
        privateKey: {
          algorithm: "RSA",
          size: 4096,
        },
        defaultLeaseTtlSeconds: 3600,
        maxLeaseTtlSeconds: 157680000,
      }),
  },

  inputs: {
    /**
     * The Vault connection used to configure the root PKI CA.
     */
    connection: connectionEntity,
  },

  outputs: {
    ca: pkiCaEntity,
  },

  meta: {
    title: "Vault PKI CA",
    icon: "simple-icons:vault",
    category: "Security",
  },

  source: {
    package: "@highstate/vault",
    path: "units/pki-ca",
  },
})

/**
 * Creates a PKI issuer role in Vault.
 */
export const pkiIssuer = defineUnit({
  type: "vault.pki.issuer.v1",

  args: {
    /**
     * The PKI role name used to issue leaf certificates.
     *
     * If not provided, it will be set to the unit name.
     */
    roleName: z.string().optional(),

    /**
     * The DNS zones for which this issuer can issue certificates.
     */
    dnsNames: z.string().array(),

    /**
     * The common names for which this issuer can issue certificates.
     */
    commonNames: z.string().array().default([]),

    /**
     * Whether the Vault role allows issuing certificates for exact allowed domains.
     */
    allowBareDomains: z.boolean().default(true),

    /**
     * Whether the Vault role allows issuing certificates for subdomains of allowed domains.
     */
    allowSubdomains: z.boolean().default(true),

    /**
     * Whether the Vault role allows issuing wildcard certificates.
     */
    allowWildcardCertificates: z.boolean().default(true),
  },

  inputs: {
    /**
     * The Vault PKI CA used to create and sign the intermediate issuer.
     */
    ca: pkiCaEntity,
  },

  outputs: {
    issuer: pkiIssuerEntity,
  },

  meta: {
    title: "Vault PKI Issuer",
    icon: "simple-icons:vault",
    category: "Security",
  },

  source: {
    package: "@highstate/vault",
    path: "units/pki-issuer",
  },
})

export type Connection = EntityValue<typeof connectionEntity>
export type ConnectionInput = EntityInput<typeof connectionEntity>

export type PkiCa = EntityValue<typeof pkiCaEntity>
export type PkiCaInput = EntityInput<typeof pkiCaEntity>

export type PkiIssuer = EntityValue<typeof pkiIssuerEntity>
export type PkiIssuerInput = EntityInput<typeof pkiIssuerEntity>
