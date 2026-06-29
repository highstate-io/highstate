import type { etcd } from "@highstate/library"
import { l4EndpointToString, MaterializedFile, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { Provider } from "@highstate/etcd-sdk"
import { type Input, toPromise } from "@highstate/pulumi"

const providers = new Map<string, Promise<Provider>>()

export async function getProvider(connection: Input<etcd.Connection>): Promise<Provider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)
    const ca = resolvedConnection.ca
      ? await MaterializedFile.open(resolvedConnection.ca)
      : undefined

    return new Provider(entityId, {
      endpoints: l4EndpointToString(endpoint),
      username: resolvedConnection.credentials?.username,
      password: resolvedConnection.credentials?.password.value,
      caCert: ca?.path,
      skipTls: !ca,
    })
  })
}
