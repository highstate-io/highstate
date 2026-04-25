import { l4EndpointToL7, l7EndpointToString } from "@highstate/common"
import { Deployment, KubeCommand, Namespace, requireBestEndpoint, Secret } from "@highstate/k8s"
import { influxdb3, k8s } from "@highstate/library"
import { forUnit, makeEntityOutput, secret, toPromise } from "@highstate/pulumi"
import { images } from "../shared"

const { args, stateId, inputs, setSecret, outputs } = forUnit(k8s.apps.refluxdb)

const { k8sCluster, s3Bucket } = await toPromise(inputs)
const s3Endpoint = requireBestEndpoint(s3Bucket.endpoints, k8sCluster)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const appSecret = Secret.create(
  args.appName,
  {
    namespace,

    stringData: {
      AWS_SECRET_ACCESS_KEY: inputs.s3Bucket.credentials.secretKey.value,
    },
  },
  { deletedWith: namespace },
)

const deployment = Deployment.create(
  args.appName,
  {
    namespace,

    container: {
      image: images.refluxdb.image,
      args: [
        "serve",
        "--object-store",
        "s3",
        "--node-id",
        args.nodeId,
        "--bucket",
        s3Bucket.name,
        "--aws-access-key-id",
        inputs.s3Bucket.credentials.accessKey.value,
        "--aws-secret-access-key",
        "$AWS_SECRET_ACCESS_KEY",
        "--aws-endpoint",
        l7EndpointToString(s3Endpoint),
        "--aws-allow-http",
        "--disable-authz",
        "health,ping,metrics",
      ],

      environmentSource: appSecret,

      port: {
        name: "http",
        containerPort: 8181,
      },

      livenessProbe: {
        httpGet: {
          port: 8181,
          path: "/health",
        },
      },
    },

    service: {
      external: args.external,
    },
  },
  { deletedWith: namespace },
)

const operatorTokenCommand = KubeCommand.execInto(`${args.appName}-operator-token`, {
  workload: deployment,
  create: "influxdb3 create token --admin --format json",
})

const operatorTokenJson = await toPromise(
  operatorTokenCommand.stdout.apply(JSON.parse).apply(data => data.token),
)

const l4Eendpoints = await toPromise(deployment.service.endpoints)
const endpoints = l4Eendpoints.map(endpoint => l4EndpointToL7(endpoint, "http"))

setSecret("operatorToken", operatorTokenJson)

const connection = makeEntityOutput({
  entity: influxdb3.connectionEntity,
  identity: stateId,
  meta: {
    title: args.appName,
  },
  value: {
    endpoints,
    credentials: {
      token: secret(operatorTokenJson),
    },
  },
})

export default outputs({
  connection,
  deployment: deployment.entity,

  $statusFields: {
    endpoints: endpoints.map(l7EndpointToString),
  },
})
