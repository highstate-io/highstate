import type { minio } from "@highstate/library"
import { l4EndpointToString, MaterializedFile, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { type Input, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/minio"

const providers = new Map<string, Promise<Provider>>()

export async function getProvider(connection: Input<minio.Connection>): Promise<Provider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)
    const ca = resolvedConnection.ca
      ? await MaterializedFile.open(resolvedConnection.ca)
      : undefined

    return new Provider(entityId, {
      minioServer: l4EndpointToString(endpoint),
      minioSsl: endpoint.appProtocol === "https",
      minioCacertFile: ca?.path,
      minioUser: resolvedConnection.credentials.username,
      minioPassword: resolvedConnection.credentials.password.value,
      minioRegion: resolvedConnection.region,
    })
  })
}
