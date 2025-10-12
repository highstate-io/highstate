import { defineEntity, defineUnit, z } from "@highstate/contract"
import * as dns from "../dns"
import { implementationReferenceSchema } from "../impl-ref"
import { l3EndpointEntity } from "../network"

export const gatewayEntity = defineEntity({
  type: "common.gateway.v1",

  schema: z.object({
    /**
     * The reference to the implementation of the gateway.
     */
    implRef: implementationReferenceSchema,

    /**
     * The public L3 endpoints of the gateway.
     *
     * If not provided, should be automatically detected by the implementation.
     */
    endpoints: l3EndpointEntity.schema.array().default([]),
  }),

  meta: {
    color: "#F57F17",
  },
})

export const tlsIssuerEntity = defineEntity({
  type: "common.tls-issuer.v1",

  schema: z.object({
    /**
     * The domain apex for which the TLS issuer will manage certificates.
     */
    domain: z.string(),

    /**
     * The reference to the implementation of the TLS issuer.
     */
    implRef: implementationReferenceSchema,
  }),

  meta: {
    color: "#F57F17",
  },
})

export const accessPointEntity = defineEntity({
  type: "common.access-point.v1",

  schema: z.object({
    /**
     * The gateway of the access point.
     */
    gateway: gatewayEntity.schema,

    /**
     * The TLS issuers used to manage TLS certificates for the access point.
     */
    tlsIssuers: tlsIssuerEntity.schema.array(),

    /**
     * The DNS providers used to manage the DNS records for the access point.
     */
    dnsProviders: dns.providerEntity.schema.array(),

    /**
     * Whether the DNS records created for the access point should be proxied.
     */
    proxied: z.boolean().default(false),
  }),

  meta: {
    color: "#F57F17",
  },
})

/**
 * The access point unit which can be used to connect to services.
 *
 * It can be used to expose services and applications running in Kubernetes clusters or other environments.
 */
export const accessPoint = defineUnit({
  type: "common.access-point.v1",

  args: {
    /**
     * Whether the DNS records created for the access point should be proxied.
     *
     * This option is specific to certain DNS providers that support proxying, such as Cloudflare.
     * When enabled, the DNS records will be proxied through the provider's network, providing additional security and performance benefits.
     *
     * Defaults to `false`.
     */
    proxied: z.boolean().default(false),
  },

  inputs: {
    gateway: gatewayEntity,
    tlsIssuers: {
      entity: tlsIssuerEntity,
      required: false,
      multiple: true,
    },
    dnsProviders: {
      entity: dns.providerEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: {
    accessPoint: accessPointEntity,
  },

  meta: {
    title: "Access Point",
    icon: "mdi:access-point",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/common",
    path: "units/access-point",
  },
})

export type Gateway = z.infer<typeof gatewayEntity.schema>
export type AccessPoint = z.infer<typeof accessPointEntity.schema>
export type TlsIssuer = z.infer<typeof tlsIssuerEntity.schema>
