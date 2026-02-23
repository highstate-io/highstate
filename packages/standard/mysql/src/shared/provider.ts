import { Provider } from "@pulumi/mysql"
import { toPromise, type Input } from "@highstate/pulumi"
import type { mysql, network } from "@highstate/library"
import { l4EndpointToString, resolveEndpoint, type ResolvedEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"

const providers = new Map<string, Promise<ResolvedProvider>>()

export type ResolvedProvider = {
  provider: Provider
  endpoint: ResolvedEndpoint<network.L4Endpoint>
}

export async function getProvider(connection: Input<mysql.Connection>): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)

    const provider = new Provider(
      entityId,
      {
        endpoint: l4EndpointToString(endpoint),
        username: resolvedConnection.credentials.username,
        password: resolvedConnection.credentials.password.value,
      },
      { hooks: endpoint.allHooks },
    )

    return { provider, endpoint }
  })
}
