import type { k8s } from "@highstate/library"
import { l34EndpointToString } from "@highstate/common"
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
import { initEnvironment } from "./scripts"

export type MongoDBDatabaseArgs = ScopedResourceArgs & {
  mongodb: Input<k8s.apps.MongoDB>
  database?: Input<string>
  username?: Input<string>
  password: Input<string>
}

export class MongoDBDatabase extends ComponentResource {
  readonly rootPassword: Secret
  readonly credentials: Secret
  readonly scriptBundle: ScriptBundle
  readonly initJob: Job
  /**
   * The network policy to allow access to the database from the namespace.
   * If the namespace is equal to the namespace of the MongoDB instance,
   * the policy will not be created.
   */
  readonly networkPolicy: Output<NetworkPolicy | undefined>

  constructor(name: string, args: MongoDBDatabaseArgs, opts?: ComponentResourceOptions) {
    super("highstate:apps:MongoDBDatabase", name, args, opts)

    this.rootPassword = Secret.create(
      `${name}-mongodb-root-password`,
      {
        namespace: args.namespace,

        stringData: {
          "mongodb-root-password": output(args.mongodb).rootPassword,
        },
      },
      { ...opts, parent: this },
    )

    const database = args.database ?? name
    const username = args.username ?? database

    const endpoint = output({
      cluster: output(args.namespace).cluster,
      endpoints: output(args.mongodb).endpoints,
    }).apply(({ endpoints, cluster }) => requireBestEndpoint(endpoints, cluster))

    const host = endpoint.apply(l34EndpointToString)
    const port = endpoint.port.apply(port => port.toString())

    this.credentials = Secret.create(
      `${name}-mongodb-credentials`,
      {
        namespace: args.namespace,

        stringData: {
          host,
          port,
          database,
          username,
          password: args.password,
          url: interpolate`mongodb://${username}:${args.password}@${host}:${port}/${database}`,
        },
      },
      { ...opts, parent: this },
    )

    this.scriptBundle = new ScriptBundle(
      `${name}-mongodb-scripts`,
      {
        namespace: args.namespace,

        distribution: "alpine",
        environments: [initEnvironment],

        environment: {
          environment: {
            MONGODB_ROOT_PASSWORD: {
              secret: this.rootPassword,
              key: "mongodb-root-password",
            },
            DATABASE_HOST: {
              secret: this.credentials,
              key: "host",
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
      `${name}-mongodb-init`,
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
      output(args.mongodb).endpoints,
      args.namespace,
    )
  }
}
