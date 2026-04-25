import type { etcd } from "@highstate/library"
import { Key as NativeKey } from "@highstate/etcd-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type KeyArgs = {
  /**
   * The connection to the etcd cluster.
   */
  connection: Input<etcd.Connection>

  /**
   * The key to set.
   */
  key: Input<string>

  /**
   * The value to set for the key.
   */
  value: Input<string>
}

export class Key extends ComponentResource {
  /**
   * The connection associated with the key.
   */
  readonly connection: Output<etcd.Connection>

  /**
   * The underlying key resource of the `@highstate/etcd-sdk` provider.
   */
  readonly key: Output<NativeKey>

  constructor(name: string, args: KeyArgs, opts?: ComponentResourceOptions) {
    super("highstate:etcd:Key", name, args, opts)

    this.connection = output(args.connection)

    this.key = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeKey(
        name,
        {
          key: args.key,
          value: args.value,
        },
        mergeOptions(opts, {
          provider,
          hooks,
          parent: this,
        }),
      )
    })
  }
}
