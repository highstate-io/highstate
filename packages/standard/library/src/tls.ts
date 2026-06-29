import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  z,
} from "@highstate/contract"
import { fileEntity, tlsIssuerEntity } from "./common"

export const privateKeyAlgorithmSchema = z.enum(["RSA", "ECDSA", "Ed25519"])

export const privateKeySchema = z
  .object({
    /**
     * The private key algorithm.
     */
    algorithm: privateKeyAlgorithmSchema.default("RSA"),

    /**
     * The private key size in bits.
     */
    size: z.number().int().positive().optional(),
  })
  .default({
    algorithm: "RSA",
    size: 4096,
  })

export const certificateChainEntity = defineEntity({
  type: "tls.certificate-chain.v1",

  includes: {
    /**
     * The file containing the certificate chain (leaf and intermediate certificates) in PEM format.
     */
    chain: fileEntity,

    /**
     * The file containing the root certificate in PEM format.
     * May be omitted if the root certificate is already trusted by the system.
     */
    root: {
      entity: fileEntity,
      required: false,
    },
  },

  schema: z.unknown(),

  meta: {
    title: "TLS Certificate Chain",
    color: "#2E7D32",
    icon: "mdi:certificate",
    iconColor: "#2E7D32",
  },
})

export const certificateEntity = defineEntity({
  type: "tls.certificate.v1",

  includes: {
    /**
     * The public chain of the certificate.
     */
    chain: certificateChainEntity,

    /**
     * The private key of the certificate in PEM format.
     */
    privateKey: fileEntity,
  },

  schema: z.unknown(),

  meta: {
    title: "TLS Certificate",
    color: "#4CAF50",
    icon: "mdi:certificate",
    iconColor: "#4CAF50",
  },
})

/**
 * Issues a TLS certificate using the provided TLS issuer.
 */
export const certificate = defineUnit({
  type: "tls.certificate.v1",

  args: {
    /**
     * The common name for the certificate.
     */
    commonName: z.string().optional(),

    /**
     * The alternative DNS names for the certificate.
     */
    dnsNames: z.string().array().default([]),

    /**
     * The private key configuration for the certificate.
     */
    privateKey: privateKeySchema,
  },

  inputs: {
    /**
     * The TLS issuer used to issue the certificate.
     */
    issuer: tlsIssuerEntity,
  },

  outputs: {
    certificate: certificateEntity,
  },

  meta: {
    title: "TLS Certificate",
    icon: "mdi:certificate",
    category: "Security",
  },

  source: {
    package: "@highstate/common",
    path: "units/tls/certificate",
  },
})

export type CertificateChain = EntityValue<typeof certificateChainEntity>
export type CertificateChainInput = EntityInput<typeof certificateChainEntity>

export type Certificate = EntityValue<typeof certificateEntity>
export type CertificateInput = EntityInput<typeof certificateEntity>

export type PrivateKeyAlgorithm = z.infer<typeof privateKeyAlgorithmSchema>
export type PrivateKeySpec = z.infer<typeof privateKeySchema>
