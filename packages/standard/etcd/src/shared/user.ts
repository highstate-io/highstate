import type { etcd } from "@highstate/library"
import { User as NativeUser } from "@highstate/etcd-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type UserArgs = {
  /**
   * The connection to the etcd database.
   */
  connection: Input<etcd.Connection>

  /**
   * The name of the user to create.
   *
   * If not provided, matches the name of the resource.
   */
  name?: Input<string>

  /**
   * The password for the user to set.
   */
  password: Input<string>

  /**
   * The roles to assign to the user.
   */
  roles?: InputArray<string>
}

export class User extends ComponentResource {
  /**
   * The connection associated with the user.
   */
  readonly connection: Output<etcd.Connection>

  /**
   * The underlying user resource of the `@highstate/etcd-sdk` provider.
   */
  readonly user: Output<NativeUser>

  constructor(name: string, args: UserArgs, opts?: ComponentResourceOptions) {
    super("highstate:etcd:User", name, args, opts)

    this.connection = output(args.connection)

    this.user = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeUser(
        name,
        {
          username: args.name ?? name,
          password: args.password,
          roles: args.roles,
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
