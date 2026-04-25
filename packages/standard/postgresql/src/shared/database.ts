import type { Role } from "./role"
import { postgresql } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  makeEntityOutput,
  makeSecret,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { Database as NativeDatabase } from "@pulumi/postgresql"
import { getProvider } from "./provider"

export type DatabaseArgs = {
  /**
   * The connection to the postgresql database.
   */
  connection: Input<postgresql.Connection>

  /**
   * The name of the database to create.
   *
   * If not provided, matches the name of the resource.
   */
  name?: Input<string>

  /**
   * The role to set as the owner of the database.
   */
  owner: Input<Role>

  /**
   * The LC_COLLATE setting for the database, which determines the collation order (i.e., how string comparison is performed).
   */
  lcCollate?: Input<string>

  /**
   * The LC_CTYPE setting for the database, which determines the character classification (i.e., how characters are categorized and compared).
   */
  lcCtype?: Input<string>
}

export class Database extends ComponentResource {
  /**
   * The connection associated with the database.
   */
  readonly connection: Output<postgresql.Connection>

  /**
   * The underlying database resource of the `@pulumi/postgresql` provider.
   */
  readonly database: Output<NativeDatabase>

  /**
   * Thn owner role of the database.
   */
  readonly owner: Output<Role>

  /**
   * The highstate entity representing the connection to the database with credentials for authentication.
   */
  get authenticatedConnection(): Output<postgresql.Connection> {
    return makeEntityOutput({
      entity: postgresql.connectionEntity,
      identity: getCombinedIdentityOutput([this.connection, this.database.name]),
      meta: {
        title: this.database.name,
      },
      value: {
        endpoints: this.connection.endpoints,
        insecure: this.connection.insecure,
        credentials: {
          type: "password",
          username: this.owner.role.name,
          password: this.owner.role.password.apply(password => password!).apply(makeSecret),
        },
        database: this.database.name,
      },
    })
  }

  constructor(name: string, args: DatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:postgresql:Database", name, args, opts)

    this.connection = output(args.connection)
    this.owner = output(args.owner)

    this.database = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeDatabase(
        name,
        {
          name: args.name ?? name,
          owner: this.owner.role.name,
          lcCollate: args.lcCollate,
          lcCtype: args.lcCtype,
        },
        mergeOptions(opts, { provider, hooks, parent: this }),
      )
    })
  }
}
