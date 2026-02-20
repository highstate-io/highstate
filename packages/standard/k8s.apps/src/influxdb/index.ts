import type { databases } from "@highstate/library"
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

export type InfluxDBDatabaseArgs = ScopedResourceArgs & {
  /**
   * The InfluxDB instance to create the database in.
   */
  influxdb: Input<databases.InfluxDB>

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

export class InfluxDBDatabase extends ComponentResource {
  /**
   * The secret to store the root password.
   */
  readonly rootCredentials: Secret

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
   * If the namespace is equal to the namespace of the InfluxDB instance,
   * the policy will not be created.
   */
  readonly networkPolicy: Output<NetworkPolicy | undefined>

  constructor(name: string, args: InfluxDBDatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:apps:InfluxDBDatabase", name, args, opts)

    const rootUsername = output(args.influxdb).apply(influxdb => influxdb.username)

    this.rootCredentials = Secret.create(
      `${name}-influxdb-root-credentials`,
      {
        namespace: args.namespace,

        stringData: {
          username: rootUsername,
          password: output(args.influxdb).apply(influxdb => influxdb.password ?? ""),
        },
      },
      { ...opts, parent: this },
    )

    const database = args.database ?? name
    const username = args.username ?? database

    const endpoint = output({
      cluster: output(args.namespace).cluster,
      endpoints: output(args.influxdb).endpoints,
    }).apply(({ endpoints, cluster }) => requireBestEndpoint(endpoints, cluster))

    const host = endpoint.apply(l3EndpointToString)
    const port = endpoint.port.apply(port => port.toString())

    this.credentials = Secret.create(
      `${name}-influxdb-credentials`,
      {
        namespace: args.namespace,

        stringData: {
          host,
          port,
          database,
          username,
          password: args.password,
          url: interpolate`http://${host}:${port}`,
        },
      },
      { ...opts, parent: this },
    )

    this.scriptBundle = new ScriptBundle(
      `${name}-influxdb-scripts`,
      {
        namespace: args.namespace,

        distribution: "alpine",
        environments: [baseEnvironment, initEnvironment],

        environment: {
          environment: {
            INFLUXDB_ROOT_USERNAME: {
              secret: this.rootCredentials,
              key: "username",
            },
            INFLUXDB_ROOT_PASSWORD: {
              secret: this.rootCredentials,
              key: "password",
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
      `${name}-influxdb-init`,
      {
        namespace: args.namespace,

        container: createScriptContainer({
          bundle: this.scriptBundle,
          main: "init-database.sh",
        }),
      },
      { ...opts, parent: this },
    )

    this.networkPolicy = output({
      namespace: args.namespace,
      endpoints: output(args.influxdb).endpoints,
    }).apply(async ({ namespace, endpoints }) =>
      NetworkPolicy.allowEgressToBestEndpoint(namespace, endpoints),
    )

    this.registerOutputs({ initJob: this.initJob })
  }
}
