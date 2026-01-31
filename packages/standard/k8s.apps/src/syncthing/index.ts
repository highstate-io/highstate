import { DnsRecordSet, generateKey } from "@highstate/common"
import { Namespace, PersistentVolumeClaim, StatefulSet } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { images } from "../shared"

const { args, inputs, getSecret, invokedTriggers, outputs } = forUnit(k8s.apps.syncthing)

const deviceFqdn = args.deviceFqdn ?? `device.${args.fqdn}`

const backupKey = getSecret("backupKey", generateKey)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
  resource: inputs.volume,
})

const volumeClaim = PersistentVolumeClaim.createOrGet(
  `${args.appName}-data`,
  { namespace, existing: inputs.volume },
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
        backupOptions: args.backupMode === "state" ? ["--exclude=index-*.db"] : [],
      },
      { dependsOn: volumeClaim, deletedWith: namespace },
    )
  : undefined

const statefulSet = StatefulSet.create(
  args.appName,
  {
    namespace,

    container: {
      image: images.syncthing.image,

      ports: [
        { name: "web", protocol: "TCP", containerPort: 8384 },
        { name: "sync-tcp", protocol: "TCP", containerPort: 22000 },
        { name: "sync-udp", protocol: "UDP", containerPort: 21025 },
      ],

      volumeMount: {
        volume: volumeClaim,
        mountPath: "/config",
      },
    },

    service: {
      external: args.external,
    },

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
    },
  },
  { deletedWith: namespace, dependsOn: backupJobPair?.restoreJob },
)

const endpoints = await toPromise(statefulSet.service.endpoints)

new DnsRecordSet(deviceFqdn, {
  providers: inputs.accessPoint.dnsProviders,
  values: endpoints.filter(endpoint => endpoint.type !== "hostname"),
})

export default outputs({
  volume: (await volumeClaim).entity,
  service: statefulSet.service.entity,
  endpoints: statefulSet.service.endpoints,

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
})
