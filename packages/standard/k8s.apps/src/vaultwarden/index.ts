import { generateKey } from "@highstate/common"
import { Deployment, Namespace, PersistentVolumeClaim, Secret } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { createMysqlCredentialsSecret, images } from "../shared"

const { args, getSecret, inputs, outputs } = forUnit(k8s.apps.vaultwarden)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const mysqlCredentials = createMysqlCredentialsSecret(
  `${args.appName}-mysql-credentials`,
  namespace,
  inputs.mysql,
)

const backupKey = getSecret("backupKey", generateKey)

const adminTokenSecret = args.enableAdminPanel
  ? Secret.create(`${args.appName}-admin-token`, {
      namespace,
      stringData: {
        token: getSecret("adminToken", generateKey),
      },
    })
  : undefined

const dataVolumeClaim = PersistentVolumeClaim.create(
  `${args.appName}-data`,
  { namespace },
  { deletedWith: namespace },
)

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        volume: dataVolumeClaim,
      },
      { dependsOn: dataVolumeClaim, deletedWith: namespace },
    )
  : undefined

const deployment = Deployment.create(args.appName, {
  namespace,

  container: {
    image: images.vaultwarden.image,

    port: {
      name: "http",
      containerPort: 80,
    },

    environment: {
      DOMAIN: `https://${args.fqdn}`,

      DATABASE_URL: {
        secret: mysqlCredentials,
        key: "url",
      },

      SIGNUPS_ALLOWED: args.allowSignup.toString(),

      ADMIN_TOKEN: adminTokenSecret
        ? {
            secret: adminTokenSecret,
            key: "token",
          }
        : undefined,
    },

    volumeMount: {
      volume: dataVolumeClaim,
      mountPath: "/data",
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
    url: `https://${args.fqdn}`,
  },

  $terminals: [...deployment.terminals, backupJobPair?.terminal],
})
