import type { vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { AuthBackend as NativeAuthBackend } from "@pulumi/vault"
import { getProvider } from "./provider"

export type AppRoleAuthBackendArgs = {
  /**
   * The connection to the Vault instance.
   */
  connection: Input<vault.Connection>

  /**
   * The auth backend mount path.
   */
  path: Input<string>
}

export class AppRoleAuthBackend extends ComponentResource {
  /**
   * The connection associated with the auth backend.
   */
  readonly connection: Output<vault.Connection>

  /**
   * The underlying AppRole auth backend resource.
   */
  readonly authBackend: Output<NativeAuthBackend>

  constructor(name: string, args: AppRoleAuthBackendArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:AppRoleAuthBackend", name, args, opts)

    this.connection = output(args.connection)

    this.authBackend = this.connection.apply(async connection => {
      const provider = await getProvider(connection)

      return new NativeAuthBackend(
        name,
        {
          path: args.path,
          type: "approle",
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })
  }
}
