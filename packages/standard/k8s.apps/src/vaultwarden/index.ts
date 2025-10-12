import { generatePassword } from "@highstate/common"
import { Deployment, Namespace } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { MariaDBDatabase } from "../mariadb"
import { images } from "../shared"

const { args, inputs, getSecret, outputs } = forUnit(k8s.apps.vaultwarden)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const database = new MariaDBDatabase(args.appName, {
  namespace,
  mariadb: inputs.mariadb,
  password: getSecret("mariadbPassword", generatePassword),
})

Deployment.create(
  args.appName,
  {
    namespace,

    container: {
      image: images.vaultwarden.image,

      port: {
        name: "http",
        containerPort: 80,
      },

      environment: {
        DATABASE_URL: {
          secret: database.credentials,
          key: "url",
        },
      },
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { dependsOn: database },
)

export default outputs({
  $statusFields: {
    url: `http://${args.fqdn}`,
  },
})
