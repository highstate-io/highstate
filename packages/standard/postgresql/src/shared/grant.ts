import type { Database } from "./database"
import type { Role } from "./role"
import { getEntityId } from "@highstate/contract"
import { postgresql } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  type InputArray,
  makeEntityOutput,
  mergeOptions,
  type Output,
  output,
} from "@highstate/pulumi"
import { Grant as NativeGrant } from "@pulumi/postgresql"
import { getProvider } from "./provider"

export type GrantArgs = {
  /**
   * The database to grant permissions on.
   */
  database: Input<Database>

  /**
   * The role to grant permissions to.
   */
  role: Input<Role>

  /**
   * The list of privileges to grant the role.
   */
  privileges: InputArray<string>
}

export class Grant extends ComponentResource {
  /**
   * The connection associated with the grant.
   */
  readonly connection: Output<postgresql.Connection>

  /**
   * The database associated with the grant.
   */
  readonly database: Output<Database>

  /**
   * The role associated with the grant.
   */
  readonly role: Output<Role>

  /**
   * The underlying grant resource of the `@pulumi/postgresql` provider.
   */
  readonly grant: Output<NativeGrant>

  /**
   * The highstate entity representing the created database accessed by the user.
   */
  get entity(): Output<postgresql.Connection> {
    return makeEntityOutput({
      entity: postgresql.connectionEntity,
      identity: getCombinedIdentityOutput([this.connection, this.database.database.name]),
      meta: {
        title: this.database.database.name,
      },
      value: {
        endpoints: this.connection.endpoints,
        insecure: this.connection.insecure,
        credentials: {
          type: "password",
          username: this.role.role.name,
          password: this.role.role.password.apply(password => password!),
        },
        database: this.database.database.name,
      },
    })
  }

  constructor(name: string, args: GrantArgs, opts?: ComponentResourceOptions) {
    super("highstate:postgresql:Grant", name, args, opts)

    this.database = output(args.database)
    this.role = output(args.role)

    this.connection = output({
      databaseConnection: this.database.connection,
      userConnection: this.role.connection,
    }).apply(({ databaseConnection, userConnection }) => {
      if (getEntityId(databaseConnection) !== getEntityId(userConnection)) {
        throw new Error("Database and user connections must be the same for a grant")
      }

      return databaseConnection
    })

    this.grant = this.connection.apply(async connection => {
      const { provider, hooks } = await getProvider(connection)

      return new NativeGrant(
        name,
        {
          database: this.database.database.name,
          role: this.role.role.name,
          objectType: "database",
          privileges: args.privileges,
        },
        mergeOptions(opts, { provider, hooks, parent: this }),
      )
    })
  }
}
