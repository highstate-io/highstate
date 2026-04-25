import type { postgresql } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { Role as NativeRole } from "@pulumi/postgresql"
import { getProvider } from "./provider"

export type UserArgs = {
  /**
   * The connection to the postgresql database.
   */
  connection: Input<postgresql.Connection>

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
}

export class Role extends ComponentResource {
  /**
   * The connection associated with the user.
   */
  readonly connection: Output<postgresql.Connection>

  /**
   * The underlying role resource of the `@pulumi/postgresql` provider.
   */
  readonly role: Output<NativeRole>

  constructor(name: string, args: UserArgs, opts?: ComponentResourceOptions) {
    super("highstate:postgresql:Role", name, args, opts)

    this.connection = output(args.connection)

    this.role = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeRole(
        name,
        {
          name: args.name ?? name,
          password: args.password,
          login: true,
        },
        mergeOptions(opts, { provider, hooks, parent: this }),
      )
    })
  }
}
