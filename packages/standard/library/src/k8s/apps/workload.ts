import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { portSchema } from "../../network"
import { namespaceEntity } from "../resources"
import { serviceEntity, serviceTypeSchema } from "../service"
import { deploymentEntity, exposableWorkloadEntity } from "../workload"
import { optionalSharedInputs, sharedInputs, source } from "./shared"

export const databaseConfigKeySchema = z.enum([
  "url",
  "host",
  "port",
  "username",
  "password",
  "database",
])

export const environmentVariableSchema = z.union([
  z.string(),
  z.object({
    dependencyKey: z.templateLiteral([
      z.enum(["mariadb", "postgresql", "mongodb"]),
      z.literal("."),
      databaseConfigKeySchema,
    ]),
  }),
  z.object({
    configKey: z.string(),
  }),
  z.object({
    secretKey: z.string(),
  }),
])

/**
 * The generic Kubernetes workload with optional service and gateway routes.
 *
 * May reference known databases and other services.
 */
export const workload = defineUnit({
  type: "k8s.apps.workload.v0",

  args: {
    /**
     * The name of the application.
     *
     * If not provided, the name of the unit will be used.
     */
    appName: z.string().optional(),

    /**
     * The name of the new namespace to create for the workload.
     *
     * If not provided, the `appName` will be used as the namespace name.
     */
    namespace: z.string().optional(),

    /**
     * The name of the existing namespace to use for the workload.
     */
    existingNamespace: z.string().optional(),

    /**
     * The type of the workload to create.
     */
    type: z
      .enum(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"])
      .default("Deployment"),

    /**
     * The image to use for the workload.
     */
    image: z.string(),

    /**
     * The command to run in the container.
     */
    command: z.array(z.string()).default([]),

    /**
     * The port to expose for the workload.
     *
     * If specified, a service will be created for the workload.
     */
    port: portSchema.optional(),

    /**
     * The FQDN of the workload.
     *
     * If specified, a service and an HTTP route will be created for the workload.
     */
    fqdn: z.string().optional(),

    /**
     * The type of the service to create for the workload.
     */
    serviceType: serviceTypeSchema.default("ClusterIP"),

    /**
     * The number of replicas for the workload.
     *
     * By default, it is set to 1.
     */
    replicas: z.number().default(1),

    /**
     * The path where the workload data will be stored.
     *
     * If specified, a persistent volume claim will be created for the workload.
     *
     * If `resticRepo` input is provided, the automatic backup will be enabled for this path.
     */
    dataPath: z.string().optional(),

    /**
     * The environment variables to set for the workload.
     *
     * The values can be:
     * 1. a static string value;
     * 2. a dependency key to service configuration (e.g., `mariadb.username`);
     * 3. a config key to reference a configuration value provided via `config` argument;
     * 4. a secret key to reference a secret value provided via `secretData` secret.
     */
    env: z.record(z.string(), environmentVariableSchema).default({}),

    /**
     * The configuration for the workload.
     *
     * If provided, the config map will be created.
     *
     * You can reference the configuration values in the environment variables using `configKey`.
     */
    config: z.record(z.string(), z.unknown()).default({}),

    /**
     * The Kubernetes manifest patch for the deployment.
     *
     * Will be applied to the deployment manifest before it is created.
     */
    manifest: z.record(z.string(), z.unknown()).default({}),

    /**
     * The Kubernetes service manifest for the deployment.
     *
     * Will be applied to the service manifest before it is created.
     */
    serviceManifest: z.record(z.string(), z.unknown()).default({}),

    /**
     * The Kubernetes HTTP route manifest for the deployment.
     *
     * Will be applied to the HTTP route manifest before it is created.
     */
    httpRouteManifest: z.record(z.string(), z.unknown()).default({}),
  },

  secrets: {
    /**
     * The password for the MariaDB database.
     *
     * If not provided and requested, a random password will be generated.
     */
    mariadbPassword: z.string().optional(),

    /**
     * The password for the PostgreSQL database.
     *
     * If not provided and requested, a random password will be generated.
     */
    postgresqlPassword: z.string().optional(),

    /**
     * The password for the MongoDB database.
     *
     * If not provided and requested, a random password will be generated.
     */
    mongodbPassword: z.string().optional(),

    /**
     * The key for the backup.
     *
     * If not provided and requested, a random key will be generated.
     */
    backupKey: z.string().optional(),

    /**
     * The secret configuration for the workload.
     *
     * If provided, the secret will be created with the specified content.
     *
     * You can reference the secret values in the environment variables using `secretKey`.
     */
    secretData: z.record(z.string(), z.string()).default({}),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    ...pick(optionalSharedInputs, [
      "accessPoint",
      "resticRepo",
      "mariadb",
      "postgresql",
      "mongodb",
    ]),
  },

  outputs: {
    namespace: namespaceEntity,
    workload: exposableWorkloadEntity,
    service: serviceEntity,
  },

  meta: {
    title: "Kubernetes Workload",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:cube-outline",
    category: "Kubernetes",
  },

  source: source("workload"),
})
