import type { hetzner } from "@highstate/library"
import { output, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/hcloud"

export async function createProvider(connection: hetzner.Connection): Promise<Provider> {
  return await toPromise(
    output(connection).apply(resolvedConnection => {
      return new Provider("hetzner", {
        token: resolvedConnection.apiToken.value,
      })
    }),
  )
}
