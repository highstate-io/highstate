import { generatePassword } from "@highstate/common"
import {
  ConfigMap,
  type ContainerEnvironment,
  Deployment,
  Namespace,
  PersistentVolumeClaim,
  Secret,
  StatefulSet,
} from "@highstate/k8s"
import { k8s } from "@highstate/library"
import { forUnit, interpolate } from "@highstate/pulumi"
import { BackupJobPair } from "@highstate/restic"

const { args, secrets, getSecret, inputs, invokedTriggers, outputs } = forUnit(k8s.apps.workload)

const appName = args.appName ?? "workload"
const namespaceName = args.namespace ?? appName

// create or get namespace
const namespace = args.existingNamespace
  ? Namespace.get(args.existingNamespace, {
      name: args.existingNamespace,
      cluster: inputs.k8sCluster,
    })
  : Namespace.create(namespaceName, { cluster: inputs.k8sCluster })

// generate secrets
const mariadbPassword = getSecret("mariadbPassword", generatePassword)
const postgresqlPassword = getSecret("postgresqlPassword", generatePassword)
const mongodbPassword = getSecret("mongodbPassword", generatePassword)
const backupPassword = getSecret("backupPassword", generatePassword)

// create secret if secretData is provided
const secret =
  Object.keys(secrets.secretData).length > 0
    ? Secret.create(
        `${appName}-secret`,
        {
          namespace,
          stringData: secrets.secretData,
        },
        { deletedWith: namespace },
      )
    : undefined

// create config map if config is provided
const configMap =
  Object.keys(args.config).length > 0
    ? ConfigMap.create(
        `${appName}-config`,
        {
          namespace,
          data: Object.fromEntries(
            Object.entries(args.config).map(([key, value]) => [
              key,
              typeof value === "string" ? value : JSON.stringify(value),
            ]),
          ),
        },
        { deletedWith: namespace },
      )
    : undefined

// create persistent volume claim if dataPath is specified
const dataVolumeClaim = args.dataPath
  ? PersistentVolumeClaim.create(`${appName}-data`, { namespace }, { deletedWith: namespace })
  : undefined

// process environment variables
const processEnvironmentVariables = (env: typeof args.env): ContainerEnvironment => {
  const environment: ContainerEnvironment = {}

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      environment[key] = value
      continue
    }

    if (typeof value !== "object" || value === null) {
      continue
    }

    if ("dependencyKey" in value && typeof value.dependencyKey === "string") {
      const [service, configKey] = value.dependencyKey.split(".")

      if (service === "mariadb" && inputs.mariadb) {
        switch (configKey) {
          case "url":
            environment[key] = interpolate`mysql://root:${mariadbPassword}@mariadb:3306/`
            break
          case "host":
            environment[key] = "mariadb"
            break
          case "port":
            environment[key] = "3306"
            break
          case "username":
            environment[key] = "root"
            break
          case "password":
            environment[key] = mariadbPassword
            break
          case "database":
            environment[key] = ""
            break
        }
      } else if (service === "postgresql" && inputs.postgresql) {
        switch (configKey) {
          case "url":
            environment[key] =
              interpolate`postgresql://postgres:${postgresqlPassword}@postgresql:5432/`
            break
          case "host":
            environment[key] = "postgresql"
            break
          case "port":
            environment[key] = "5432"
            break
          case "username":
            environment[key] = "postgres"
            break
          case "password":
            environment[key] = postgresqlPassword
            break
          case "database":
            environment[key] = ""
            break
        }
      } else if (service === "mongodb" && inputs.mongodb) {
        switch (configKey) {
          case "url":
            environment[key] = interpolate`mongodb://root:${mongodbPassword}@mongodb:27017/`
            break
          case "host":
            environment[key] = "mongodb"
            break
          case "port":
            environment[key] = "27017"
            break
          case "username":
            environment[key] = "root"
            break
          case "password":
            environment[key] = mongodbPassword
            break
          case "database":
            environment[key] = ""
            break
        }
      }
    } else if ("configKey" in value && typeof value.configKey === "string" && configMap) {
      environment[key] = {
        configMap,
        key: value.configKey,
      }
    } else if ("secretKey" in value && typeof value.secretKey === "string" && secret) {
      environment[key] = {
        secret,
        key: value.secretKey,
      }
    }
  }

  return environment
}

const environment = processEnvironmentVariables(args.env)

// create backup job pair if restic repo and data path are provided
const backupJobPair =
  inputs.resticRepo && dataVolumeClaim
    ? new BackupJobPair(
        `${appName}-backup`,
        {
          namespace,
          resticRepo: inputs.resticRepo,
          backupKey: backupPassword,
          volume: dataVolumeClaim,
        },
        { dependsOn: dataVolumeClaim, deletedWith: namespace },
      )
    : undefined

// create the workload based on type
let workload: Deployment | StatefulSet

const baseWorkloadConfig = {
  namespace,
  replicas: args.replicas,

  container: {
    image: args.image,
    command: args.command.length > 0 ? args.command : undefined,
    environment,

    ...(args.port && {
      port: {
        name: "http",
        containerPort: args.port,
      },
    }),

    ...(dataVolumeClaim &&
      args.dataPath && {
        volumeMount: {
          volume: dataVolumeClaim,
          mountPath: args.dataPath,
        },
      }),
  },

  ...(args.port &&
    args.fqdn &&
    inputs.accessPoint && {
      route: {
        type: "http" as const,
        accessPoint: inputs.accessPoint,
        fqdn: args.fqdn,
        manifest: args.httpRouteManifest,
      },
    }),

  ...(args.port && {
    service: {
      type: args.serviceType,
      manifest: args.serviceManifest,
    },
  }),

  manifest: args.manifest,
}

const workloadOptions = {
  dependsOn: backupJobPair?.restoreJob,
  deletedWith: namespace,
}

// create deployment or statefulset based on type
if (args.type === "StatefulSet") {
  workload = StatefulSet.create(appName, baseWorkloadConfig, workloadOptions)
} else {
  workload = Deployment.create(appName, baseWorkloadConfig, workloadOptions)
}

export default outputs({
  namespace: namespace.entity,
  deployment: workload.entity,
  service: workload.service?.entity,

  $triggers: [backupJobPair?.handleTrigger(invokedTriggers)],
})
