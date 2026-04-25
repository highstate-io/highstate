import type { mysql } from "@highstate/library"
import { Database as NativeDatabase } from "@highstate/mysql-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type DatabaseArgs = {
  /**
   * The connection to the mysql database.
   */
  connection: Input<mysql.Connection>

  /**
   * The name of the database to create.
   *
   * If not provided, matches the name of the resource.
   */
  name?: Input<string>
}

export class Database extends ComponentResource {
  /**
   * The connection associated with the database.
   */
  readonly connection: Output<mysql.Connection>

  /**
   * The underlying database resource of the `@pulumi/mysql` provider.
   */
  readonly database: Output<NativeDatabase>

  constructor(name: string, args: DatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:mysql:Database", name, args, opts)

    this.connection = output(args.connection)

    this.database = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeDatabase(
        name,
        {
          name: args.name ?? name,
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
