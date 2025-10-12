import type { k8s } from "@highstate/library"
import { l3EndpointToString } from "@highstate/common"
import {
  createScriptContainer,
  Job,
  NetworkPolicy,
  requireBestEndpoint,
  type ScopedResourceArgs,
  ScriptBundle,
  Secret,
} from "@highstate/k8s"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  interpolate,
  type Output,
  output,
} from "@highstate/pulumi"
import { baseEnvironment, initEnvironment } from "./scripts"

export type PostgreSQLDatabaseArgs = ScopedResourceArgs & {
  /**
   * The PostgreSQL instance to create the database in.
   */
  postgresql: Input<k8s.apps.PostgreSQL>

  /**
   * The name of the database to create.
   *
   * By default, the database name is the same as the name of the resource.
   */
  database?: Input<string>

  /**
   * The name of the user to create.
   *
   * By default, the user name is the same as the database name.
   */
  username?: Input<string>

  /**
   * The password of the user.
   */
  password: Input<string>
}

export class PostgreSQLDatabase extends ComponentResource {
  /**
   * The secret to store the root password.
   */
  readonly rootPassword: Secret

  /**
   * The secret to store the database credentials.
   */
  readonly credentials: Secret

  /**
   * The script bundle used to create the database.
   */
  readonly scriptBundle: ScriptBundle

  /**
   * The job to create the database.
   */
  readonly initJob: Job

  /**
   * The network policy to allow access to the database from the namespace.
   * If the namespace is equal to the namespace of the PostgreSQL instance,
   * the policy will not be created.
   */
  readonly networkPolicy: Output<NetworkPolicy | undefined>

  constructor(name: string, args: PostgreSQLDatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:apps:PostgreSQLDatabase", name, args, opts)

    this.rootPassword = Secret.create(
      `${name}-postgresql-root-password`,
      {
        namespace: args.namespace,

        stringData: {
          "postgres-password": output(args.postgresql).rootPassword,
        },
      },
      { ...opts, parent: this },
    )

    const database = args.database ?? name
    const username = args.username ?? database

    const endpoint = output({
      cluster: output(args.namespace).cluster,
      endpoints: output(args.postgresql).endpoints,
    }).apply(({ endpoints, cluster }) => requireBestEndpoint(endpoints, cluster))

    const host = endpoint.apply(l3EndpointToString)
    const port = endpoint.port.apply(port => port.toString())

    this.credentials = Secret.create(
      `${name}-postgresql-credentials`,
      {
        namespace: args.namespace,

        stringData: {
          host,
          port,
          database,
          username,
          password: args.password,
          url: interpolate`postgresql://${username}:${args.password}@${host}:${port}/${database}`,
        },
      },
      { ...opts, parent: this },
    )

    this.scriptBundle = new ScriptBundle(
      `${name}-postgresql-scripts`,
      {
        namespace: args.namespace,

        distribution: "alpine",
        environments: [baseEnvironment, initEnvironment],

        environment: {
          environment: {
            PGPASSWORD: {
              secret: this.rootPassword,
              key: "postgres-password",
            },
            DATABASE_HOST: {
              secret: this.credentials,
              key: "host",
            },
            DATABASE_PORT: {
              secret: this.credentials,
              key: "port",
            },
            DATABASE_NAME: {
              secret: this.credentials,
              key: "database",
            },
            DATABASE_USER: {
              secret: this.credentials,
              key: "username",
            },
            DATABASE_PASSWORD: {
              secret: this.credentials,
              key: "password",
            },
          },
        },
      },
      { ...opts, parent: this },
    )

    this.initJob = Job.create(
      `${name}-postgresql-init`,
      {
        namespace: args.namespace,

        container: createScriptContainer({
          bundle: this.scriptBundle,
          main: "init-database.sh",
        }),
      },
      { ...opts, parent: this },
    )

    this.networkPolicy = NetworkPolicy.allowEgressToBestEndpoint(
      output(args.postgresql).endpoints,
      args.namespace,
    )
  }
}
