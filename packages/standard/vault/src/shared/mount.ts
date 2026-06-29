import type { vault } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { Mount as NativeMount } from "@pulumi/vault"
import { getProvider } from "./provider"

export type PkiMountArgs = {
  /**
   * The connection to the Vault instance.
   */
  connection: Input<vault.Connection>

  /**
   * The mount path of the PKI backend.
   */
  path: Input<string>

  /**
   * The default lease TTL of the PKI backend in seconds.
   */
  defaultLeaseTtlSeconds: Input<number>

  /**
   * The maximum lease TTL of the PKI backend in seconds.
   */
  maxLeaseTtlSeconds: Input<number>
}

export class PkiMount extends ComponentResource {
  /**
   * The connection associated with the PKI mount.
   */
  readonly connection: Output<vault.Connection>

  /**
   * The underlying Vault PKI mount resource.
   */
  readonly mount: Output<NativeMount>

  constructor(name: string, args: PkiMountArgs, opts?: ComponentResourceOptions) {
    super("highstate:vault:PkiMount", name, args, opts)

    this.connection = output(args.connection)

    this.mount = this.connection.apply(async connection => {
      const provider = await getProvider(connection)

      return new NativeMount(
        name,
        {
          path: args.path,
          type: "pki",
          defaultLeaseTtlSeconds: args.defaultLeaseTtlSeconds,
          maxLeaseTtlSeconds: args.maxLeaseTtlSeconds,
        },
        mergeOptions(opts, { provider, parent: this }),
      )
    })
  }
}
