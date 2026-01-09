import { defineEntity, defineUnit, z } from "@highstate/contract"
import { implementationReferenceSchema } from "./impl-ref"
import { l3EndpointEntity, l4EndpointEntity, networkArgs } from "./network"
import { arrayPatchModeSchema, prefixKeysWith } from "./utils"
import { mapValues, pick } from "remeda"

export const providerEntity = defineEntity({
  type: "dns.provider.v1",

  schema: z.object({
    /**
     * The ID of the DNS provider unique within the system.
     */
    id: z.string(),

    /**
     * The domain apex for which the DNS records will be created.
     *
     * If the provider manages multiple domains, the separate provider entity should be created for each domain.
     */
    domain: z.string(),

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
    ...createArgs(),

    ...mapValues(
      //
      pick(networkArgs, ["endpointFilter"]),
      arg => ({ ...arg, schema: arg.schema.default(`type != "hostname"`) }),
    ),

    /**
     * The values of the DNS record.
     */
    values: z.string().array().default([]),

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
  },

  outputs: {
    l3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },

    l4Endpoints: {
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

export function createArgs<TPrefix extends string = "">(prefix?: TPrefix) {
  return prefixKeysWith(prefix, {
    /**
     * The FQDN to register the existing endpoints with.
     *
     * Will be inserted at the beginning of the resulting endpoint list.
     *
     * Will throw an error if no matching provider is found.
     */
    fqdn: z.string().optional(),

    /**
     * The tag regex to apply to filter endpoints.
     *
     * If at least one tag matches, the endpoint is included.
     */
    tagPattern: z.string().optional(),

    /**
     * The mode to use for patching the existing endpoints.
     *
     * - `prepend`: Prepend the FQDN to the existing endpoints. It will make them prioritized.
     * - `replace`: Replace the existing endpoints with the FQDN. It will ensure that the only the FQDN is used.
     *
     * The default is `prepend`.
     */
    patchMode: arrayPatchModeSchema.default("prepend"),
  })
}

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
