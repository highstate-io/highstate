import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  z,
} from "@highstate/contract"
import * as dns from "../dns"
import { implementationReferenceSchema } from "../impl-ref"
import { l3EndpointEntity } from "../network"
import { booleanPatchSchema } from "../utils"
import { fileEntity } from "./files"

const gatewayClientAuthSchema = z.object({
  /**
   * The PEM-encoded CA certificates used to validate client certificates.
   */
  ca: z.string().array(),

  /**
   * The DNS SAN patterns to validate on client certificates.
   */
  dnsNames: z.string().array().default([]),
})

const gatewayPatchArgs = {
  /**
   * The public L3 endpoints to set on the gateway.
   *
   * If not specified, the existing endpoints will be kept.
   */
  endpoints: z.string().array().default([]),

  /**
   * The DNS SAN patterns to validate on client certificates.
   */
  clientAuthDnsNames: z.string().array().default([]),
}

const gatewayPatchInputs = {
  /**
   * The public L3 endpoints to set on the gateway.
   *
   * These endpoints take precedence over the endpoints argument.
   */
  endpoints: {
    entity: l3EndpointEntity,
    required: false,
    multiple: true,
  },

  /**
   * The CA certificate files used to validate client certificates.
   */
  clientAuthCa: {
    entity: fileEntity,
    required: false,
    multiple: true,
  },
} as const

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

    /**
     * The default client certificate validation configuration for routes using this gateway.
     */
    clientAuth: gatewayClientAuthSchema.optional(),
  }),

  meta: {
    title: "Gateway",
    icon: "mdi:router-network",
    iconColor: "#F57F17",
    color: "#F57F17",
  },
})

export const tlsIssuerEntity = defineEntity({
  type: "common.tls-issuer.v1",

  schema: z.object({
    /**
     * The zones for which the TLS issuer will manage certificates.
     */
    zones: z.string().array(),

    /**
     * The reference to the implementation of the TLS issuer.
     */
    implRef: implementationReferenceSchema,
  }),

  meta: {
    title: "TLS Issuer",
    icon: "mdi:certificate-outline",
    iconColor: "#F57F17",
    color: "#F57F17",
  },
})

export const accessPointEntity = defineEntity({
  type: "common.access-point.v1",

  includes: {
    /**
     * The gateway of the access point.
     */
    gateway: gatewayEntity,

    /**
     * The TLS issuers used to manage TLS certificates for the access point.
     */
    tlsIssuers: {
      entity: tlsIssuerEntity,
      multiple: true,
    },

    /**
     * The DNS providers used to manage the DNS records for the access point.
     */
    dnsProviders: {
      entity: dns.providerEntity,
      multiple: true,
    },
  },

  schema: z.object({
    /**
     * Whether the DNS records created for the access point should be proxied.
     */
    proxied: z.boolean().default(false),
  }),

  meta: {
    title: "Access Point",
    icon: "mdi:access-point",
    iconColor: "#F57F17",
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

/**
 * Patches some properties of the gateway and outputs the updated gateway.
 */
export const gatewayPatch = defineUnit({
  type: "common.gateway-patch.v1",

  args: gatewayPatchArgs,

  inputs: {
    gateway: gatewayEntity,
    ...gatewayPatchInputs,
  },

  outputs: {
    gateway: gatewayEntity,
  },

  meta: {
    title: "Gateway Patch",
    icon: "mdi:router-network",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/common",
    path: "units/gateway-patch",
  },
})

/**
 * Patches some properties of the access point and outputs the updated access point.
 */
export const accessPointPatch = defineUnit({
  type: "common.access-point-patch.v1",

  args: {
    ...gatewayPatchArgs,

    /**
     * Whether the DNS records created for the access point should be proxied.
     *
     * If not specified, the existing value will be kept.
     */
    proxied: booleanPatchSchema,
  },

  inputs: {
    accessPoint: accessPointEntity,
    gateway: {
      entity: gatewayEntity,
      required: false,
    },
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
    ...gatewayPatchInputs,
  },

  outputs: {
    accessPoint: accessPointEntity,
  },

  meta: {
    title: "Access Point Patch",
    icon: "mdi:access-point",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/common",
    path: "units/access-point-patch",
  },
})

export type Gateway = EntityValue<typeof gatewayEntity>
export type AccessPoint = EntityValue<typeof accessPointEntity>
export type TlsIssuer = EntityValue<typeof tlsIssuerEntity>

export type GatewayInput = EntityInput<typeof gatewayEntity>
export type AccessPointInput = EntityInput<typeof accessPointEntity>
export type TlsIssuerInput = EntityInput<typeof tlsIssuerEntity>
