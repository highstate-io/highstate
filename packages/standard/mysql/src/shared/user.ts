import type { mysql } from "@highstate/library"
import { User as NativeUser } from "@highstate/mysql-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
  secret,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type UserArgs = {
  /**
   * The connection to the mysql database.
   */
  connection: Input<mysql.Connection>

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

export class User extends ComponentResource {
  /**
   * The connection associated with the user.
   */
  readonly connection: Output<mysql.Connection>

  /**
   * The underlying user resource of the `@pulumi/mysql` provider.
   */
  readonly user: Output<NativeUser>

  /**
   * The password set for the user.
   */
  readonly password: Output<string>

  constructor(name: string, args: UserArgs, opts?: ComponentResourceOptions) {
    super("highstate:mysql:User", name, args, opts)

    this.connection = output(args.connection)
    this.password = secret(args.password)

    this.user = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeUser(
        name,
        {
          user: args.name ?? name,
          plaintextPassword: args.password,
          host: "%",
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
