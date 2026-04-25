import type { mongodb } from "@highstate/library"
import { type LifetimeScopeHooks, l3EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { Provider } from "@highstate/mongodb-sdk"
import { type Input, toPromise } from "@highstate/pulumi"

const providers = new Map<string, Promise<ResolvedProvider>>()

export type ResolvedProvider = {
  provider: Provider
  hooks: LifetimeScopeHooks
}

export async function getProvider(
  connection: Input<mongodb.Connection>,
): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const { endpoint, hooks } = await resolveEndpoint(resolvedConnection.endpoints)

    const provider = new Provider(entityId, {
      host: l3EndpointToString(endpoint),
      port: endpoint.port.toString(),
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password.value,
    })

    return { provider, hooks }
  })
}
