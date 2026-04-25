import type { yandex } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { output, toPromise } from "@highstate/pulumi"
import { Provider } from "@highstate/yandex-sdk"

export async function createProvider(
  connection: yandex.Connection,
  cloudId?: Input<string>,
): Promise<Provider> {
  return await toPromise(
    output(connection).apply(connection => {
      return new Provider(connection.cloudId, {
        serviceAccountKeyFile: connection.authorizedKeyJson.value,
        cloudId: cloudId ?? connection.cloudId,
        folderId: connection.defaultFolderId,
        zone: connection.defaultZone,
        regionId: connection.regionId,
      })
    }),
  )
}
