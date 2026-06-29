import type { postgresql } from "@highstate/library"
import { l3EndpointToString, MaterializedFile, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { type Input, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/postgresql"

const providers = new Map<string, Promise<Provider>>()

export async function getProvider(connection: Input<postgresql.Connection>): Promise<Provider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)
    const ca = resolvedConnection.ca
      ? await MaterializedFile.open(resolvedConnection.ca)
      : undefined

    return new Provider(entityId, {
      host: l3EndpointToString(endpoint),
      port: endpoint.port,
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password.value,
      sslmode: resolvedConnection.insecure ? "disable" : ca ? "verify-ca" : "require",
      sslrootcert: ca?.path,
    })
  })
}
