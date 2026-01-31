/** biome-ignore-all lint/style/noNonNullAssertion: to define shared inputs */

import type { Simplify } from "type-fest"
import {
  $args,
  $inputs,
  $secrets,
  type FullComponentArgumentOptions,
  type FullComponentInputOptions,
  text,
  z,
} from "@highstate/contract"
import { mapValues } from "remeda"
import { accessPointEntity } from "../../common"
import {
  etcdEntity,
  mariadbEntity,
  mongodbEntity,
  postgresqlEntity,
  redisEntity,
} from "../../databases"
import { providerEntity } from "../../dns"
import { repositoryEntity } from "../../restic"
import { namespaceEntity, persistentVolumeClaimEntity } from "../resources"
import { clusterEntity } from "../shared"

export const sharedArgs = $args({
  /**
   * The FQDN where the application will be accessible.
   */
  fqdn: z.string(),

  /**
   * The endpoints where the application will or should be accessible.
   *
   * Can be both L3 (IP addresses) or L4 (IP:port) endpoints and the interpretation is up to the application.
   */
  endpoints: z.string().array().default([]),

  /**
   * Whether the application should be exposed externally by NodePort or LoadBalancer service.
   */
  external: z.boolean().default(false),

  /**
   * The number of replicas for the application.
   */
  replicas: z.number().default(1),
})

type ToOptionalArgs<T extends Record<string, FullComponentArgumentOptions>> = Simplify<{
  [K in keyof T]: Simplify<Omit<T[K], "schema"> & { schema: z.ZodOptional<T[K]["schema"]> }>
}>

export const optionalSharedArgs = mapValues(sharedArgs, arg => ({
  ...arg,
  schema: arg.schema.optional(),
})) as ToOptionalArgs<typeof sharedArgs>

/**
 * Return the arguments definition for the application name.
 *
 * @param defaultAppName The default name of the application.
 */
export function appName(defaultAppName: string) {
  return {
    appName: {
      schema: z.string().default(defaultAppName),
      meta: {
        description: text`
          The name of the application to deploy.
          Defines the name of the namespace and other resources.

          If not provided, defaults to "${defaultAppName}".
        `,
      },
    },
  }
}

export const sharedSecrets = $secrets({
  /**
   * The root password for the database instance. If not provided, a random password will be generated.
   */
  rootPassword: z.string().optional(),

  /**
   * The key to use for backup encryption. If not provided, a random key will be generated.
   */
  backupKey: z.string().optional(),
})

export const sharedDatabaseArgs = $args({
  /**
   * The username for the database user.
   *
   * If not provided, defaults to the name of the instance.
   */
  username: z.string().optional(),

  /**
   * The name of the database to create.
   *
   * If not provided, defaults to the username.
   */
  database: z.string().optional(),
})

export const sharedDatabaseSecrets = $secrets({
  /**
   * The password for the database user.
   *
   * If not provided, a random password will be generated.
   */
  password: z.string().optional(),
})

export const sharedInputs = $inputs({
  k8sCluster: {
    entity: clusterEntity,
  },
  namespace: {
    entity: namespaceEntity,
  },
  accessPoint: {
    entity: accessPointEntity,
  },
  resticRepo: {
    entity: repositoryEntity,
  },
  dnsProviders: {
    entity: providerEntity,
    multiple: true,
  },
  volume: {
    entity: persistentVolumeClaimEntity,
  },
  mariadb: {
    entity: mariadbEntity,
  },
  postgresql: {
    entity: postgresqlEntity,
  },
  mongodb: {
    entity: mongodbEntity,
  },
  redis: {
    entity: redisEntity,
  },
  etcd: {
    entity: etcdEntity,
  },
})

type ToOptionalInputs<T extends Record<string, FullComponentInputOptions>> = Simplify<{
  [K in keyof T]: T[K] & { required: false }
}>

export const optionalSharedInputs = mapValues(sharedInputs, input => ({
  ...input,
  required: false,
})) as ToOptionalInputs<typeof sharedInputs>

export function source(path: string) {
  return {
    package: "@highstate/k8s.apps",
    path,
  }
}
