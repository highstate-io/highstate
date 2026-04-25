import type { minio } from "@highstate/library"
import { type LifetimeScopeHooks, l4EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { type Input, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/minio"

const providers = new Map<string, Promise<ResolvedProvider>>()

export type ResolvedProvider = {
  provider: Provider
  hooks: LifetimeScopeHooks
}

export async function getProvider(connection: Input<minio.Connection>): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const { endpoint, hooks } = await resolveEndpoint(resolvedConnection.endpoints)

    const provider = new Provider(entityId, {
      minioServer: l4EndpointToString(endpoint),
      minioSsl: endpoint.appProtocol === "https",
      minioUser: resolvedConnection.credentials.username,
      minioPassword: resolvedConnection.credentials.password.value,
      minioRegion: resolvedConnection.region,
    })

    return { provider, hooks }
  })
}
