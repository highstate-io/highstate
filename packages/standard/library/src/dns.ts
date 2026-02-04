import { defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { mapValues, pick } from "remeda"
import { serverEntity } from "./common/server"
import { implementationReferenceSchema } from "./impl-ref"
import { l3EndpointEntity, l4EndpointEntity, networkArgs } from "./network"

export const providerEntity = defineEntity({
  type: "dns.provider.v1",

  schema: z.object({
    /**
     * The ID of the DNS provider unique within the system.
     */
    id: z.string(),

    /**
     * The zones managed by the DNS provider.
     */
    zones: z.string().array(),

    /**
     * The reference to the implementation of the DNS provider.
     */
    implRef: implementationReferenceSchema,
  }),

  meta: {
    color: "#FF5722",
  },
})

export const recordSet = defineUnit({
  type: "dns.record-set.v1",

  args: {
    /**
     * The FQDN of the DNS to create.
     *
     * If not provided, the name of the unit will be used.
     */
    recordName: z.string().optional(),

    /**
     * The values of the DNS record.
     *
     * Will be parsed as endpoints and merged with provided L3/L4/L7 endpoint inputs.
     */
    values: z.string().array().default([]),

    ...mapValues(
      //
      pick(networkArgs, ["endpointFilter"]),
      arg => ({ ...arg, schema: arg.schema.default(`type != "hostname"`) }),
    ),

    /**
     * The TTL of the DNS record.
     */
    ttl: z.number().optional(),

    /**
     * The priority of the DNS record.
     */
    priority: z.number().optional(),

    /**
     * Whether the DNS record is proxied.
     *
     * Available only for public IPs and some DNS providers like Cloudflare.
     */
    proxied: z.boolean().default(false),

    /**
     * Wait for the DNS record creation/update to be visible at local DNS before continuing.
     */
    waitLocal: z.boolean().default(true),
  },

  inputs: {
    /**
     * The DNS providers to use to create the DNS records.
     *
     * For each provider, a separate DNS record will be created.
     */
    dnsProviders: {
      entity: providerEntity,
      multiple: true,
    },

    /**
     * The servers to wait for the DNS records to be visible at before continuing.
     */
    waitServers: {
      entity: serverEntity,
      required: false,
      multiple: true,
    },

    /**
     * The L3 endpoints to use as values of the DNS records.
     */
    l3Endpoints: {
      entity: l3EndpointEntity,
      required: false,
      multiple: true,
    },

    /**
     * The L4 endpoints to use as values of the DNS records.
     */
    l4Endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },

    /**
     * The L7 endpoints to use as values of the DNS records.
     */
    l7Endpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: {
    /**
     * The filtered L3 endpoints with all IPs replaced with FQDNs.
     * The duplicates are removed and metadata is merged.
     */
    l3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },

    /**
     * The filtered L4 endpoints with all IPs replaced with FQDNs.
     * The duplicates are removed and metadata is merged.
     */
    l4Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },

    /**
     * The filtered L7 endpoints with all IPs replaced with FQDNs.
     * The duplicates are removed and metadata is merged.
     */
    l7Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "DNS Record Set",
    description: "A set of DNS records to be created.",
    icon: "mdi:server",
    defaultNamePrefix: "record",
    category: "Network",
  },

  source: {
    package: "@highstate/common",
    path: "units/dns/record-set",
  },
})

export const inputs = {
  /**
   * The DNS providers to use to create the DNS records.
   *
   * If multiple providers match the domain, all of them will be used and multiple DNS records will be created.
   */
  dnsProviders: {
    entity: providerEntity,
    multiple: true,
  },
} as const

export type Provider = z.infer<typeof providerEntity.schema>
export type ProviderInput = EntityInput<typeof providerEntity>
