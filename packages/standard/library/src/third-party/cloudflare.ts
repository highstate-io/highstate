import { defineUnit, z } from "@highstate/contract"
import { providerEntity } from "../dns"

export const providerDataSchema = z.object({
  /**
   * The zone ID of the Cloudflare zone.
   */
  zoneId: z.string(),

  /**
   * The API token for the Cloudflare account.
   *
   * The API key must have permissions to manage DNS records for exactly one zone.
   * If multiple zones are specified, the unit will fail.
   *
   * The required permissions are:
   * - `Zone:Read`
   * - `Zone:DNS:Edit`
   */
  apiToken: z.string(),
})

/**
 * The Cloudflare connection for a single zone.
 */
export const connection = defineUnit({
  type: "cloudflare.connection.v1",

  secrets: {
    /**
     * The API token for the Cloudflare account.
     *
     * The API key must have permissions to manage DNS records for exactly one zone.
     * If multiple zones are specified, the unit will fail.
     *
     * The required permissions are:
     * - `Zone.Zone:Read`
     * - `Zone.DNS:Edit`
     */
    apiToken: z.string(),
  },

  outputs: {
    dnsProvider: providerEntity,
  },

  meta: {
    title: "Cloudflare Connection",
    icon: "simple-icons:cloudflare",
    iconColor: "#F38020",
    category: "Cloudflare",
  },

  source: {
    package: "@highstate/cloudflare",
    path: "connection",
  },
})

export type ProviderData = z.infer<typeof providerDataSchema>
