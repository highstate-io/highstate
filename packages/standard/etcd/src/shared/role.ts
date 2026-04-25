import type { RolePermission } from "@highstate/etcd-sdk/types/input"
import type { etcd } from "@highstate/library"
import { Role as NativeRole } from "@highstate/etcd-sdk"
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

export type RoleArgs = {
  /**
   * The connection to the etcd cluster.
   */
  connection: Input<etcd.Connection>

  /**
   * The permissions to assign to the role.
   */
  permissions: InputArray<RolePermission>

  /**
   * The name of the role to create in the etcd cluster.
   *
   * If not provided, mathes the name of the resource.
   */
  name?: Input<string>
}

export class Role extends ComponentResource {
  /**
   * The connection associated with the role.
   */
  readonly connection: Output<etcd.Connection>

  /**
   * The underlying role resource of the `@highstate/etcd-sdk` provider.
   */
  readonly role: Output<NativeRole>

  constructor(name: string, args: RoleArgs, opts?: ComponentResourceOptions) {
    super("highstate:etcd:Role", name, args, opts)

    this.connection = output(args.connection)

    this.role = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeRole(
        name,
        {
          name: args.name ?? name,
          permissions: args.permissions,
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
