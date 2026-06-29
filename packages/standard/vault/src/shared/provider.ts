import type { vault } from "@highstate/library"
import { l7EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { type Input, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/vault"

const providers = new Map<string, Promise<Provider>>()

export async function getProvider(connection: Input<vault.Connection>): Promise<Provider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)
    const address = l7EndpointToString(endpoint)

    const commonArgs = {
      address,
      namespace: resolvedConnection.namespace,
      tlsServerName: resolvedConnection.tlsServerName,
    }

    if (resolvedConnection.credentials.type === "token") {
      return new Provider(entityId, {
        ...commonArgs,
        token: resolvedConnection.credentials.token.value,
      })
    }

    return new Provider(entityId, {
      ...commonArgs,
      authLogin: {
        path: `auth/${resolvedConnection.credentials.authPath}/login`,
        parameters: {
          role_id: resolvedConnection.credentials.roleId,
          secret_id: resolvedConnection.credentials.secretId.value,
        },
      },
    })
  })
}
