import { defineEntity, defineUnit, z } from "@highstate/contract"
import { l3EndpointEntity, l4EndpointEntity } from "./network"

export const repositoryEntity = defineEntity({
  type: "restic.repository.v1",

  schema: z.object({
    remoteEndpoints: z.union([l3EndpointEntity.schema, l4EndpointEntity.schema]).array(),

    type: z.literal("rclone"),
    rcloneConfig: z.string(),
    remoteName: z.string(),
    pathPattern: z.string(),
  }),

  meta: {
    color: "#e56901",
  },
})

/**
 * Holds the configuration for a Restic repository and its remote storage.
 */
export const repository = defineUnit({
  type: "restic.repository.v1",

  args: {
    /**
     * The remote endpoints of the cloud storage where the Restic repository will be stored.
     *
     * They will be used to create network policies to allow access to the storage.
     *
     * For some cloud providers, these endpoints can be automatically discovered.
     */
    remoteEndpoints: z.string().array().default([]),

    /**
     * The pattern for the path where backups will be stored for the specific application.
     *
     * Available variables:
     *
     * - `$clusterName`: The name of the Kubernetes cluster where the application is deployed.
     * - `$appName`: The name of the application for which the backups are being created. Corresponds to the `appName` argument of the unit.
     * - `$unitName`: The name of the unit, which deploys the application, provided by the user.
     *
     * By default, the path pattern is `backups/$clusterName/$appName`.
     */
    pathPattern: z.string().default("backups/$clusterName/$appName"),
  },

  secrets: {
    rcloneConfig: z.string().meta({ language: "ini" }),
  },

  inputs: {
    remoteL3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
      required: false,
    },
    remoteL4Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    repo: repositoryEntity,
  },

  meta: {
    title: "Restic Repo",
    iconColor: "#e56901",
    icon: "material-symbols:backup",
    category: "Infrastructure",
  },

  source: {
    package: "@highstate/restic",
    path: "repository",
  },
})

export type Repository = z.infer<typeof repositoryEntity.schema>
