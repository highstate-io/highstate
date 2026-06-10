import type { gcp } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { output, toPromise } from "@highstate/pulumi"
import { Provider } from "@pulumi/gcp"

export async function createProvider(
  connection: gcp.Connection,
  projectId?: Input<string>,
  region?: Input<string>,
  zone?: Input<string>,
): Promise<Provider> {
  return await toPromise(
    output(connection).apply((resolvedConnection: gcp.Connection) => {
      return new Provider(resolvedConnection.projectId, {
        credentials: resolvedConnection.serviceAccountKeyJson.value,
        project: projectId ?? resolvedConnection.projectId,
        region: region ?? resolvedConnection.defaultRegion,
        zone: zone ?? resolvedConnection.defaultZone,
      })
    }),
  )
}
