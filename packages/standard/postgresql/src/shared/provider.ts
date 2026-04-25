import type { postgresql } from "@highstate/library"
import { type LifetimeScopeHooks, l3EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { type Input, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/postgresql"

const providers = new Map<string, Promise<ResolvedProvider>>()

export type ResolvedProvider = {
  provider: Provider
  hooks: LifetimeScopeHooks
}

export async function getProvider(
  connection: Input<postgresql.Connection>,
): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const { endpoint, hooks } = await resolveEndpoint(resolvedConnection.endpoints)

    const provider = new Provider(entityId, {
      host: l3EndpointToString(endpoint),
      port: endpoint.port,
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password.value,
      sslmode: resolvedConnection.insecure ? "disable" : "require",
    })

    return { provider, hooks }
  })
}
