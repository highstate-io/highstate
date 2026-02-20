import { generatePassword, l3EndpointToString, l4EndpointToString } from "@highstate/common"
import { Deployment, Namespace, requireBestEndpoint, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, output, toPromise } from "@highstate/pulumi"

const { args, getSecret, inputs, outputs } = forUnit(k8s.apps.influxdb)

const namespace = inputs.namespace
  ? await Namespace.forAsync(inputs.namespace, inputs.k8sCluster)
  : Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const rootPassword = getSecret("adminPassword", generatePassword)

const rootCredentialsSecret = Secret.create(
  `${args.appName}-root-credentials`,
  {
    namespace,

    stringData: {
      username: args.rootUsername,
      password: rootPassword,
    },
  },
  { deletedWith: namespace },
)

const s3Bucket = output(inputs.s3).apply(s3 => s3.buckets[0]?.name ?? "")

const s3Endpoint = output({
  cluster: inputs.k8sCluster,
  endpoints: inputs.s3.endpoints,
}).apply(({ endpoints, cluster }) => requireBestEndpoint(endpoints, cluster))

const s3Host = s3Endpoint.apply(l3EndpointToString)
const s3Port = s3Endpoint.port.apply(port => port.toString())

const s3Secret = Secret.create(
  `${args.appName}-s3`,
  {
    namespace,

    stringData: {
      host: s3Host,
      port: s3Port,
      region: output(inputs.s3).apply(s3 => s3.region ?? ""),
      bucket: s3Bucket,
      accessKey: output(inputs.s3).apply(s3 => s3.accessKey),
      secretKey: output(inputs.s3).apply(s3 => s3.secretKey),
    },
  },
  { deletedWith: namespace },
)

const deployment = Deployment.create(
  args.appName,
  {
    namespace,

    replicas: args.replicas,

    container: {
      image: args.image,

      command: args.command,
      args: args.containerArgs,

      port: {
        name: "http",
        containerPort: args.port,
      },

      environment: {
        INFLUXDB_ROOT_USERNAME: args.rootUsername,
        INFLUXDB_ROOT_PASSWORD: {
          secret: rootCredentialsSecret,
          key: "password",
        },

        S3_HOST: {
          secret: s3Secret,
          key: "host",
        },
        S3_PORT: {
          secret: s3Secret,
          key: "port",
        },
        S3_REGION: {
          secret: s3Secret,
          key: "region",
        },
        S3_BUCKET: {
          secret: s3Secret,
          key: "bucket",
        },
        S3_ACCESS_KEY: {
          secret: s3Secret,
          key: "accessKey",
        },
        S3_SECRET_KEY: {
          secret: s3Secret,
          key: "secretKey",
        },
      },
    },

    service: {
      external: args.external,
    },
  },
  { dependsOn: [s3Secret, rootCredentialsSecret] },
)

const endpoints = await toPromise(deployment.service.endpoints)

export default outputs({
  influxdb: {
    endpoints,
    username: args.rootUsername,
    password: rootPassword,
  },
  service: deployment.service.entity,

  $statusFields: {
    endpoints: endpoints.map(l4EndpointToString),
  },
})
