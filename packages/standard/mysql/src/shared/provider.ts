import type { mysql } from "@highstate/library"
import { type LifetimeScopeHooks, l4EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { Provider } from "@highstate/mysql-sdk"
import { type Input, toPromise } from "@highstate/pulumi"

const providers = new Map<string, Promise<ResolvedProvider>>()

export type ResolvedProvider = {
  provider: Provider
  hooks: LifetimeScopeHooks
}

export async function getProvider(connection: Input<mysql.Connection>): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const { endpoint, hooks } = await resolveEndpoint(resolvedConnection.endpoints)

    const provider = new Provider(entityId, {
      endpoint: l4EndpointToString(endpoint),
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password.value,
    })

    return { provider, hooks }
  })
}
