import type { timeweb } from "@highstate/library"
import { type Input, output, toPromise } from "@highstate/pulumi"
import { Provider } from "@highstate/timeweb-sdk"

export async function createProvider(connection: Input<timeweb.Connection>): Promise<Provider> {
  return await toPromise(
    output(connection).apply(connection => {
      return new Provider(connection.name, { token: connection.apiToken })
    }),
  )
}
