import { Command, l4EndpointToL7, l7EndpointToString, MaterializedFile } from "@highstate/common"
import { Deployment, Namespace, requireBestEndpoint, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate, secret, toPromise } from "@highstate/pulumi"
import { images } from "../shared"

const { args, inputs, setSecret, outputs } = forUnit(k8s.apps.refluxdb)

const { k8sCluster, s3Bucket } = await toPromise(inputs)
const s3Endpoint = requireBestEndpoint(s3Bucket.endpoints, k8sCluster)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const appSecret = Secret.create(
  args.appName,
  {
    namespace,

    stringData: {
      AWS_SECRET_ACCESS_KEY: inputs.s3Bucket.credentials.secretKey,
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
        inputs.s3Bucket.credentials.accessKey,
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

const kubeconfigText = await toPromise(inputs.k8sCluster.kubeconfig)
await using config = await MaterializedFile.create("kubeconfig", kubeconfigText)

const operatorTokenCommand = new Command("create-operator-token", {
  host: "local",
  ignoreCommandChanges: true,
  logging: "stderr",
  create: [
    "kubectl exec -it",
    interpolate`deploy/${deployment.metadata.name}`,
    `--kubeconfig ${config.path}`,
    interpolate`-n ${namespace.metadata.name}`,
    "--",
    "influxdb3 create token --admin --format json",
  ],
  triggers: [deployment.metadata.uid],
})

const operatorTokenJson = await toPromise(
  operatorTokenCommand.stdout.apply(JSON.parse).apply(data => data.token),
)

const l4Eendpoints = await toPromise(deployment.service.endpoints)
const endpoints = l4Eendpoints.map(endpoint => l4EndpointToL7(endpoint, "http"))

setSecret("operatorToken", operatorTokenJson)

export default outputs({
  connection: {
    endpoints,

    credentials: {
      token: secret(operatorTokenJson),
    },
  },

  deployment: deployment.entity,

  $statusFields: {
    endpoints: endpoints.map(l7EndpointToString),
  },
})
