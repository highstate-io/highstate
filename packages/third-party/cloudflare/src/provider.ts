import type { cloudflare } from "@highstate/library"
import { getOrCreate } from "@highstate/contract"
import { Provider } from "@pulumi/cloudflare"

const providers = new Map<string, Provider>()

export function getProvider(data: cloudflare.ProviderData): Provider {
  return getOrCreate(
    providers,
    data.zoneId,
    () => new Provider(data.zoneId, { apiToken: data.apiToken }),
  )
}
