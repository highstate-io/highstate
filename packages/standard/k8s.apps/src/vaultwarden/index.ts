import { Deployment, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { createMysqlCredentialsSecret, images } from "../shared"

const { args, inputs, outputs } = forUnit(k8s.apps.vaultwarden)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const mysqlCredentials = createMysqlCredentialsSecret(
  `${args.appName}-mysql-credentials`,
  namespace,
  inputs.mysql,
)

const deployment = Deployment.create(args.appName, {
  namespace,

  container: {
    image: images.vaultwarden.image,

    port: {
      name: "http",
      containerPort: 80,
    },

    environment: {
      DATABASE_URL: {
        secret: mysqlCredentials,
        key: "url",
      },
    },
  },

  route: {
    type: "http",
    accessPoint: inputs.accessPoint,
    fqdn: args.fqdn,
  },
})

export default outputs({
  $statusFields: {
    url: `http://${args.fqdn}`,
  },

  $terminals: deployment.terminals,
})
