import { generateKey, generatePassword } from "@highstate/common"
import { Namespace, NetworkPolicy, PersistentVolumeClaim, StatefulSet } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"

const { args, inputs, getSecret, invokedTriggers, outputs } = forUnit(k8s.apps.codeServer)

const existingVolume = await toPromise(inputs.volume)

const password = getSecret("password", generatePassword)
const sudoPassword = getSecret("sudoPassword", generatePassword)
const backupKey = getSecret("backupKey", generateKey)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
  resource: existingVolume,
})

const volumeClaim = PersistentVolumeClaim.create(
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

        volume: volumeClaim,
      },
      { dependsOn: volumeClaim, deletedWith: namespace },
    )
  : undefined

const statefulSet = StatefulSet.create(
  args.appName,
  {
    namespace,

    container: {
      image:
        "linuxserver/code-server@sha256:f9b31566f3bdba06cb2e5f732bdc2cdd3bad39fe67dcdce6a4aee42b3585627b",

      port: {
        name: "web",
        protocol: "TCP",
        containerPort: 8443,
      },

      volumeMount: {
        volume: volumeClaim,
        mountPath: "/config",
      },

      environment: {
        PROXY_DOMAIN: args.fqdn,
        PASSWORD: password,
        SUDO_PASSWORD: sudoPassword,
      },
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { deletedWith: namespace },
)

NetworkPolicy.allowAllEgress(namespace)

export default outputs({
  statefulSet: statefulSet.entity,
  volume: volumeClaim.entity,
  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
})
