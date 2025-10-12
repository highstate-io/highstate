import type { yandex } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { output, toPromise } from "@highstate/pulumi"
import { Provider } from "@highstate/yandex-sdk"

export async function createProvider(cloud: Input<yandex.Cloud>): Promise<Provider> {
  return await toPromise(
    output(cloud).apply(cloudConfig => {
      return new Provider("yandex", {
        token: cloudConfig.token,
        serviceAccountKeyFile: cloudConfig.serviceAccountKeyFile,
        cloudId: cloudConfig.cloudId,
        folderId: cloudConfig.defaultFolderId,
        zone: cloudConfig.defaultZone,
        regionId: cloudConfig.regionId,
      })
    }),
  )
}
