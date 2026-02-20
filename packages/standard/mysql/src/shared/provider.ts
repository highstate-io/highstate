import { Provider, type ProviderArgs } from "@pulumi/mysql"
import { toPromise, type Input, type ResourceOptions } from "@highstate/pulumi"
import type { mysql } from "@highstate/library"
import { l4EndpointToString, resolveEndpoint, type ResolvedEndpoint } from "@highstate/common"

export class ResolvedProvider extends Provider {
  constructor(
    name: string,
    args: ProviderArgs | undefined,
    opts: ResourceOptions | undefined,
    readonly resolvedEndpoint: ResolvedEndpoint,
  ) {
    super(name, args, opts)
  }
}

export async function createProvider(
  connection: Input<mysql.Connection>,
): Promise<ResolvedProvider> {
  const resolvedConnection = await toPromise(connection)
  const endpoint = await resolveEndpoint(resolvedConnection.endpoints)

  return new ResolvedProvider(
    "provider",
    {
      endpoint: l4EndpointToString(endpoint),
      username: resolvedConnection.credentials.username,
      password: resolvedConnection.credentials.password,
    },
    undefined,
    endpoint,
  )
}
