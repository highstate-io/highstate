import type { Database } from "./database"
import type { User } from "./user"
import { getEntityId } from "@highstate/contract"
import { mysql } from "@highstate/library"
import { Grant as NativeGrant } from "@highstate/mysql-sdk"
import {
  ComponentResource,
  type ComponentResourceOptions,
  getCombinedIdentityOutput,
  type Input,
  type InputArray,
  makeEntityOutput,
  makeSecretOutput,
  type Output,
  output,
} from "@highstate/pulumi"
import { getProvider } from "./provider"

export type GrantArgs = {
  /**
   * The database to grant permissions on.
   */
  database: Input<Database>

  /**
   * The user to grant permissions to.
   */
  user: Input<User>

  /**
   * The list of privileges to grant the user.
   */
  privileges: InputArray<string>
}

export class Grant extends ComponentResource {
  /**
   * The connection associated with the grant.
   */
  readonly connection: Output<mysql.Connection>

  /**
   * The database associated with the grant.
   */
  readonly database: Output<Database>

  /**
   * The user associated with the grant.
   */
  readonly user: Output<User>

  /**
   * The underlying grant resource of the `@pulumi/mysql` provider.
   */
  readonly grant: Output<NativeGrant>

  /**
   * The highstate entity representing the connection to the database with the granted permissions.
   */
  get authenticatedConnection(): Output<mysql.Connection> {
    return makeEntityOutput({
      entity: mysql.connectionEntity,
      identity: getCombinedIdentityOutput([this.connection, this.database.database.name]),
      meta: {
        title: this.database.database.name,
      },
      value: {
        endpoints: this.connection.endpoints,
        credentials: {
          type: "password",
          username: this.user.user.user,
          password: makeSecretOutput(this.user.password.apply(password => password!)),
        },
        database: this.database.database.name,
      },
    })
  }

  constructor(name: string, args: GrantArgs, opts?: ComponentResourceOptions) {
    super("highstate:mysql:Grant", name, args, opts)

    this.database = output(args.database)
    this.user = output(args.user)

    this.connection = output({
      databaseConnection: this.database.connection,
      userConnection: this.user.connection,
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
          user: this.user.user.user,
          database: this.database.database.name,
          privileges: args.privileges,
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
