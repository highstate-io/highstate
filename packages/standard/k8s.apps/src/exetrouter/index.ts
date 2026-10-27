import { generateKey, l4EndpointToString } from "@highstate/common"
import { ConfigMap, Namespace, PersistentVolumeClaim, Service, StatefulSet } from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"
import { images } from "../shared"
import { backupExcludes, onlineBackupScript, postRestoreScript } from "./backup"

const { args, inputs, getSecret, invokedTriggers, outputs } = forUnit(k8s.apps.exetrouter)

const backupKey = getSecret("backupKey", generateKey)

const namespace = await Namespace.createOrGet(args.appName, {
  cluster: inputs.k8sCluster,
  resource: inputs.volume,
})

const volume = await PersistentVolumeClaim.createOrGet(`${args.appName}-data`, {
  namespace,
  existing: inputs.volume,
})

const backupJobPair = inputs.resticRepo
  ? new BackupJobPair(
      args.appName,
      {
        namespace,
        resticRepo: inputs.resticRepo,
        backupKey,
        volume,
        scheduling: args.scheduling,
        exclude: backupExcludes,
        environment: {
          alpine: { packages: ["sqlite"] },
          files: {
            "online-backup.sh": onlineBackupScript,
            "post-restore.sh": postRestoreScript,
          },
        },
      },
      { dependsOn: volume },
    )
  : undefined

const config = ConfigMap.create(`${args.appName}-config`, {
  namespace,
  data: {
    "config.json": JSON.stringify({
      db: "/state/private/exetrouter.sqlite",
      key: "/state/private/exetrouter.key",
      oauth_key: "/state/private/exetrouter.oauth.key",
      control_socket: "/run/exetrouter/control.sock",
      gateway_uid: 10003,
      listen: "0.0.0.0:8787",
    }),
  },
})

const runtime = { name: "runtime", emptyDir: {} }
const configMount = {
  volume: config,
  mountPath: "/etc/exetrouter/config.json",
  subPath: "config.json",
  readOnly: true,
}
const runtimeMount = { volume: runtime, mountPath: "/run/exetrouter" }

const statefulSet = StatefulSet.create(
  args.appName,
  {
    namespace,
    replicas: 1,
    template: { spec: args.scheduling },
    terminal: { shell: "bash" },

    initContainer: {
      name: "prepare",
      image: images.exetrouter.image,
      args: ["prepare"],
      securityContext: { runAsUser: 0 },
      volumeMounts: [{ volume, mountPath: "/state" }, configMount, runtimeMount],
    },

    containers: [
      {
        name: "api",
        image: images.exetrouter.image,
        args: ["api"],
        securityContext: {
          runAsUser: 10001,
          runAsGroup: 10002,
          runAsNonRoot: true,
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] },
        },
        port: { name: "http", containerPort: 8787 },
        volumeMounts: [
          { volume, mountPath: "/state/private", subPath: "private" },
          configMount,
          runtimeMount,
          { volume: { name: "tmp", emptyDir: {} }, mountPath: "/tmp" },
        ],
        startupProbe: {
          httpGet: { path: "/healthz", port: "http" },
          failureThreshold: 30,
          periodSeconds: 2,
        },
        readinessProbe: { httpGet: { path: "/healthz", port: "http" } },
        livenessProbe: { httpGet: { path: "/healthz", port: "http" }, periodSeconds: 30 },
      },
      {
        name: "management",
        image: images.exetrouter.image,
        args: ["ssh"],
        securityContext: { runAsUser: 0 },
        // SSH is exposed by a separate service, never by the HTTP API service
        volumeMounts: [
          { volume, mountPath: "/ssh", subPath: "ssh", readOnly: true },
          configMount,
          runtimeMount,
        ],
        readinessProbe: { tcpSocket: { port: 2222 } },
        livenessProbe: { tcpSocket: { port: 2222 }, periodSeconds: 30 },
      },
    ],

    route: {
      type: "http",
      accessPoint: inputs.accessPoint,
      fqdn: args.fqdn,
      dnsChallengeAlias: args.dnsChallengeAlias,
      servicePort: 8787,
      path: "/v1/",
    },

    networkPolicy: {
      ingressRule: { fromAll: true, toPort: { port: 2222 } },
      egressRule: { toAll: true },
    },
  },
  { dependsOn: backupJobPair?.restoreJob },
)

const managementService = Service.create(`${args.appName}-management`, {
  ...args.service,
  namespace,
  selector: statefulSet.podTemplate.metadata.labels,
  ports: [{ name: "ssh", port: 2222, targetPort: 2222 }],
})

export default outputs({
  statefulSet: statefulSet.entity,
  volume: volume.entity,
  managementService: managementService.entity,

  $terminals: [...statefulSet.terminals, ...(backupJobPair?.terminals ?? [])],
  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
  $statusFields: {
    apiUrl: `https://${args.fqdn}/v1`,
    managementEndpoints: managementService.endpoints.apply(endpoints =>
      endpoints.map(l4EndpointToString),
    ),
  },
  $pages: {
    index: {
      meta: { title: "ExetRouter setup" },
      content: [
        {
          type: "markdown",
          content: interpolate`Open the API container terminal to create a user and register an Ed25519 public key:

\`\`\`sh
exrd admin user-create owner
exrd admin user-list
cat > /tmp/owner.pub
# paste the public key, then press Ctrl-D
exrd admin ssh-key-add --user-id 1 --public-key-file /tmp/owner.pub
rm /tmp/owner.pub
exrd admin oauth add --device
\`\`\`

Use the ID returned by user-create. New SSH bindings are exported within five seconds.
View the SSH host fingerprint using:

\`\`\`sh
kubectl -n ${namespace.metadata.name} exec statefulset/${statefulSet.metadata.name} -c management -- ssh-keygen -lf /ssh/ssh_host_ed25519_key.pub
\`\`\`

Forward the management service locally, or set service.external to expose it through the cluster's external service type:

\`\`\`sh
kubectl -n ${namespace.metadata.name} port-forward service/${managementService.metadata.name} 2222:2222
exr configure --host localhost --port 2222 --ssh-user routercli --identity ~/.ssh/exetrouter_ed25519 --api-url https://${args.fqdn}/v1
exr
\`\`\`

Verify the SSH host fingerprint on the first connection. Create API tokens in the local exr client, which copies them to your desktop clipboard.
The API endpoint is https://${args.fqdn}/v1. State, both credential keys, and the SSH host key persist on the volume.
Use exrd admin backup create and verify for consistent backups before upgrading or moving the volume.
`,
        },
      ],
    },
  },
})
