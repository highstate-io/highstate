import type { mongodb } from "@highstate/library"
import type { DbUserRole } from "@highstate/mongodb-sdk/types/input"
import { DbUser as NativeUser } from "@highstate/mongodb-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  type Output,
  output,
  secret,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type UserArgs = {
  /**
   * The connection to the mongodb database.
   */
  connection: Input<mongodb.Connection>

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
  roles: InputArray<DbUserRole>
}

export class User extends ComponentResource {
  /**
   * The connection associated with the user.
   */
  readonly connection: Output<mongodb.Connection>

  /**
   * The underlying user resource of the `@pulumi/mongodb-sdk` provider.
   */
  readonly user: Output<NativeUser>

  /**
   * The password set for the user.
   */
  readonly password: Output<string>

  constructor(name: string, args: UserArgs, opts?: ComponentResourceOptions) {
    super("highstate:mongodb:User", name, args, opts)

    this.connection = output(args.connection)
    this.password = secret(args.password)

    this.user = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeUser(
        name,
        {
          name: args.name ?? name,
          password: args.password,
          authDatabase: "admin",
          roles: args.roles,
        },
        {
          ...opts,
          provider,
          hooks,
          parent: this,
        },
      )
    })
  }
}
