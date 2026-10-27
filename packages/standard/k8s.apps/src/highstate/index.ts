import { generateKey } from "@highstate/common"
import {
  getClusterKubeconfigContent,
  getProvider,
  Namespace,
  PersistentVolumeClaim,
  Secret,
} from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, makeFile, output, secret, toPromise } from "@highstate/pulumi"
import { local } from "@pulumi/command"
import { batch, core, rbac } from "@pulumi/kubernetes"
import { generateIdentity } from "age-encryption"
import { createLoginConfig, createPostgresqlConfig } from "./config"
import { coordinateBackupScript, offlineBackupScript } from "./scripts"
import { createRuntimeDeployment } from "./workload"

const { name, args, inputs, getSecret, invokedTriggers, outputs } = forUnit(k8s.apps.highstate)
const cluster = await toPromise(inputs.k8sCluster)
const provider = getProvider(cluster)
const namespace = inputs.volume
  ? await Namespace.forResourceAsync(inputs.volume, cluster)
  : Namespace.create(args.appName, { cluster, privileged: true }, { retainOnDelete: true })
const ns = namespace.metadata.name
const backendIdentity = getSecret("backendIdentity", generateIdentity)
const backupKey = getSecret("backupKey", generateKey)
const providers = await toPromise(inputs.loginProviders)
if (args.initialAdminUserIds.length + args.initialAdminGroupIds.length === 0) {
  throw new Error("Configure at least one initial admin user or group ID")
}
const pg = await toPromise(inputs.postgresql)
const postgresqlConfig = await createPostgresqlConfig(pg, cluster)
const runtime = Secret.create(`${args.appName}-runtime`, {
  namespace,
  stringData: {
    "backend-identity": backendIdentity,
    "providers.json": secret(createLoginConfig(providers)),
    "initial-admins.json": JSON.stringify({
      userIds: args.initialAdminUserIds,
      groupIds: args.initialAdminGroupIds,
    }),
    "postgresql-url": secret(postgresqlConfig.url),
    ...(postgresqlConfig.ca ? { "postgresql-ca.crt": secret(postgresqlConfig.ca) } : {}),
  },
})
const volume = await PersistentVolumeClaim.createOrGet(
  `${args.appName}-data`,
  {
    namespace,
    existing: inputs.volume,
    size: args.storageSize,
    storageClassName: args.storageClassName,
    accessModes: ["ReadWriteOncePod"],
  },
  { retainOnDelete: true },
)
if (inputs.volume && !(await toPromise(volume.spec.accessModes)).includes("ReadWriteOncePod")) {
  throw new Error(
    "Highstate requires a ReadWriteOncePod PVC to enforce exclusive runtime and backup ownership",
  )
}
const claimName = volume.metadata.name
const runtimeSecretName = runtime.metadata.name
const deployment = createRuntimeDeployment({
  name: args.appName,
  namespace,
  runtime,
  claimName,
  image: args.image,
  dockerImage: args.dockerImage,
  publicUrl: `https://${args.fqdn}`,
  maintenance: args.maintenance,
  route: {
    type: "http",
    accessPoint: inputs.accessPoint,
    fqdn: args.fqdn,
    fqdns: [`*.panels.${args.fqdn}`],
  },
})

const backupTemplateName = `${args.appName}-offline-backup`
if (inputs.resticRepo) {
  const repo = await toPromise(inputs.resticRepo)
  const repoPath = repo.pathPattern
    .replaceAll("$clusterName", cluster.name)
    .replaceAll("$appName", args.appName)
    .replaceAll("$unitName", name)
  const credentials = Secret.create(`${args.appName}-backup`, {
    namespace,
    stringData: {
      password: backupKey,
      "rclone.conf": secret(repo.rcloneConfig.value),
      repository: `rclone:${repo.remoteName}:${repoPath}`,
    },
  })
  const account = new core.v1.ServiceAccount(
    `${args.appName}-backup`,
    { metadata: { namespace: ns } },
    { provider },
  )
  const role = new rbac.v1.Role(
    `${args.appName}-backup`,
    {
      metadata: { namespace: ns },
      rules: [
        {
          apiGroups: ["apps"],
          resources: ["deployments"],
          resourceNames: [deployment.metadata.name],
          verbs: ["get"],
        },
        { apiGroups: [""], resources: ["pods"], verbs: ["list"] },
        {
          apiGroups: [""],
          resources: ["configmaps"],
          resourceNames: ["highstate-backup-lock"],
          verbs: ["get"],
        },
      ],
    },
    { provider },
  )
  const binding = new rbac.v1.RoleBinding(
    `${args.appName}-backup`,
    {
      metadata: { namespace: ns },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: role.metadata.name },
      subjects: [{ kind: "ServiceAccount", namespace: ns, name: account.metadata.name }],
    },
    { provider },
  )
  const backupTemplate = new batch.v1.CronJob(
    backupTemplateName,
    {
      metadata: { name: backupTemplateName, namespace: ns },
      spec: {
        schedule: "0 0 * * *",
        suspend: true,
        concurrencyPolicy: "Forbid",
        jobTemplate: {
          spec: {
            backoffLimit: 0,
            activeDeadlineSeconds: 3500,
            template: {
              spec: {
                restartPolicy: "Never",
                serviceAccountName: account.metadata.name,
                containers: [
                  {
                    name: "backup",
                    image: args.image,
                    securityContext: { runAsUser: 0 },
                    command: ["sh", "-c", offlineBackupScript],
                    env: [
                      { name: "NAMESPACE", value: ns },
                      { name: "DEPLOYMENT", value: deployment.metadata.name },
                      {
                        name: "HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL",
                        valueFrom: {
                          secretKeyRef: { name: runtimeSecretName, key: "postgresql-url" },
                        },
                      },
                      {
                        name: "RESTIC_REPOSITORY",
                        valueFrom: {
                          secretKeyRef: { name: credentials.metadata.name, key: "repository" },
                        },
                      },
                      { name: "RESTIC_PASSWORD_FILE", value: "/credentials/password" },
                      { name: "RCLONE_CONFIG", value: "/credentials/rclone.conf" },
                      {
                        name: "HIGHSTATE_BACKUP_MANIFEST",
                        value: JSON.stringify({
                          format: "highstate-offline-v1",
                          image: args.image,
                          dockerImage: args.dockerImage,
                          publicUrl: `https://${args.fqdn}`,
                        }),
                      },
                    ],
                    volumeMounts: [
                      { name: "data", mountPath: "/data", readOnly: true },
                      { name: "recovery", mountPath: "/recovery", readOnly: true },
                      { name: "credentials", mountPath: "/credentials", readOnly: true },
                      { name: "scratch", mountPath: "/backup" },
                    ],
                  },
                ],
                volumes: [
                  { name: "data", persistentVolumeClaim: { claimName, readOnly: true } },
                  { name: "recovery", secret: { secretName: runtimeSecretName } },
                  { name: "credentials", secret: { secretName: credentials.metadata.name } },
                  { name: "scratch", emptyDir: {} },
                ],
              },
            },
          },
        },
      },
    },
    { provider, dependsOn: [binding] },
  )

  const invocation = invokedTriggers.find(trigger => trigger.name === "backup")
  if (invocation) {
    new local.Command(
      `${args.appName}-backup`,
      {
        create: `set -eu\nconfig=$(mktemp)\ntrap 'rm -f "$config"' EXIT\nchmod 600 "$config"\nprintf '%s' "$KUBECONFIG_CONTENT" > "$config"\nexport KUBECONFIG="$config"\n(\n${coordinateBackupScript}\n)`,
        environment: {
          KUBECONFIG_CONTENT: secret(getClusterKubeconfigContent(cluster)),
          NAMESPACE: ns,
          DEPLOYMENT: deployment.metadata.name,
          BACKUP_TEMPLATE: backupTemplateName,
          RESUME: "false",
        },
      },
      { dependsOn: [backupTemplate, deployment] },
    )
  }
}

export default outputs({
  $statusFields: {
    url: `https://${args.fqdn}`,
    backup: inputs.resticRepo ? "Coordinated offline backup available" : "No repository connected",
  },
  $terminals: deployment.terminals,
  $triggers:
    inputs.resticRepo && !invokedTriggers.some(trigger => trigger.name === "backup")
      ? [{ name: "backup", meta: { title: "Offline backup" }, spec: { type: "before-destroy" } }]
      : [],
  $pages: {
    index: {
      meta: { title: "Operations" },
      content: [
        {
          type: "markdown",
          content:
            "Run backup from an independent bootstrap backend or operator terminal. Initialize the Restic repository first. Set NAMESPACE, DEPLOYMENT and BACKUP_TEMPLATE using the status below. The script leaves Highstate stopped on failure; inspect the job before resuming. Recovery instructions are in @highstate/k8s.apps/README.md.",
        },
        {
          type: "markdown",
          content: output({ namespace: ns, deployment: deployment.metadata.name }).apply(
            value =>
              `Namespace: ${value.namespace}\nDeployment: ${value.deployment}\nBackup template: ${backupTemplateName}`,
          ),
        },
        { type: "file", file: makeFile({ name: "backup.sh", content: coordinateBackupScript }) },
      ],
    },
  },
})
