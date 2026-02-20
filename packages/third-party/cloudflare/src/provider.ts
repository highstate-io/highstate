import type { cloudflare } from "@highstate/library"
import { getOrCreate } from "@highstate/contract"
import { Provider } from "@pulumi/cloudflare"

const providers = new Map<string, Provider>()

export function getProvider(data: cloudflare.ProviderData): Provider {
  return getOrCreate(
    providers,
    data.zoneIds[Object.keys(data.zoneIds)[0]],
    () => new Provider(data.zoneIds[Object.keys(data.zoneIds)[0]], { apiToken: data.apiToken }),
  )
}
