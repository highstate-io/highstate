import { DnsRecordSet, filterEndpoints, generateKey, l3EndpointToString } from "@highstate/common"
import { Deployment, Namespace, PersistentVolumeClaim } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { images } from "../shared"

const { args, inputs, invokedTriggers, getSecret, outputs } = forUnit(k8s.gameServers.openttd)

const namespace = Namespace.create(args.appName, { cluster: inputs.k8sCluster })

const backupKey = getSecret("backupKey", generateKey)

const dataVolumeClaim = PersistentVolumeClaim.create("data", {
  namespace,
  size: "100Mi",
})

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,

        resticRepo: inputs.resticRepo,
        backupKey,

        volume: dataVolumeClaim,
      },
      { dependsOn: dataVolumeClaim },
    )
  : undefined

const deployment = Deployment.create(args.appName, {
  namespace,

  container: {
    image: images.openttd.image,

    volumeMounts: [{ volume: dataVolumeClaim, mountPath: "/config" }],

    ports: [
      { name: "game-tcp", containerPort: args.port, protocol: "TCP" },
      { name: "game-udp", containerPort: args.port, protocol: "UDP" },
    ],

    stdin: true,
    tty: true,

    environment: {
      loadgame: "exit",
    },
  },

  service: {
    external: true,
  },
})

const endpoints = await toPromise(inputs.k8sCluster.endpoints)
const publicEndpoint = filterEndpoints(endpoints, ["public"])[0]

if (!publicEndpoint) {
  throw new Error(
    "Failed to determine public endpoint of the game server. Available endpoints: " +
      endpoints.map(l3EndpointToString).join(", "),
  )
}

new DnsRecordSet(args.fqdn, {
  providers: inputs.dnsProviders,
  value: filterEndpoints(endpoints, ["public"])[0],
  waitAt: "local",
})

export default outputs({
  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $terminals: [deployment.terminal, backupJobPair?.terminal],
})
