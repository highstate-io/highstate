import { generatePassword } from "@highstate/common"
import { Deployment, Namespace, PersistentVolumeClaim } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"

const { args, inputs, getSecret, invokedTriggers, outputs } = forUnit(k8s.apps.grocy)

const backupPassword = getSecret("backupPassword", generatePassword)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
})

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
        backupKey: backupPassword,

        volume: dataVolumeClaim,
      },
      { dependsOn: dataVolumeClaim, deletedWith: namespace },
    )
  : undefined

Deployment.create(
  args.appName,
  {
    namespace,

    container: {
      image:
        "lscr.io/linuxserver/grocy@sha256:cb2d9fd877c05c093b685161399f537a5df2d00d7041a8e1be133145e9fe4347",

      port: {
        name: "http",
        containerPort: 80,
      },

      environment: {
        PUID: "1000",
        PGID: "1000",
        TZ: "Etc/UTC",
      },

      volumeMount: {
        volume: dataVolumeClaim,
        mountPath: "/config",
      },
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { dependsOn: backupJobPair?.restoreJob, deletedWith: namespace },
)

export default outputs({
  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
})
