import type { mongodb } from "@highstate/library"
import { l3EndpointToString, resolveEndpoint } from "@highstate/common"
import { getEntityId, getOrCreate } from "@highstate/contract"
import { Provider } from "@highstate/mongodb-sdk"
import { type Input, toPromise } from "@highstate/pulumi"

function getCertificateContent(ca: mongodb.Connection["ca"]): string | undefined {
  if (!ca) {
    return undefined
  }

  if (ca.content.type === "embedded") {
    return ca.content.value
  }

  if (ca.content.type === "embedded-secret") {
    return ca.content.value.value
  }

  throw new Error(
    `MongoDB CA file content type "${ca.content.type}" is not supported. Use an embedded CA file.`,
  )
}

const providers = new Map<string, Promise<Provider>>()

export async function getProvider(connection: Input<mongodb.Connection>): Promise<Provider> {
  const resolvedConnection = await toPromise(connection)

  return await getOrCreate(providers, getEntityId(resolvedConnection), async entityId => {
    const endpoint = await resolveEndpoint(resolvedConnection.endpoints)

    return new Provider(entityId, {
      host: l3EndpointToString(endpoint),
      port: endpoint.port.toString(),
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password.value,
      tls: !!resolvedConnection.ca,
      certificate: getCertificateContent(resolvedConnection.ca),
    })
  })
}
