import {
  ComponentResource,
  output,
  type Output,
  type ComponentResourceOptions,
  type Input,
} from "@highstate/pulumi"
import type { mysql } from "@highstate/library"
import { Database as NativeDatabase } from "@pulumi/mysql"
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
   * The underlying database resource of the `@pulumi/mysql` provider.
   */
  readonly database: Output<NativeDatabase>

  constructor(name: string, args: DatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:mysql:Database", name, args, opts)

    this.database = output(args.connection).apply(async connection => {
      const { provider, endpoint } = await getProvider(connection)

      return new NativeDatabase(
        name,
        {
          name: args.name ?? name,
        },
        {
          ...opts,
          provider,
          hooks: endpoint.hooks,
          parent: this,
        },
      )
    })
  }
}
