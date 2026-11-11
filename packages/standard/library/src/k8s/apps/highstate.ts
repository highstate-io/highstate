import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { loginProviderEntity } from "../../oauth"
import { appName, optionalSharedInputs, sharedArgs, sharedInputs, source } from "./shared"

const pinnedImage = z
  .string()
  .regex(/^\S+@sha256:[a-f0-9]{64}$/, "Supply an immutable image digest")

/**
 * A single-owner Highstate control plane with an isolated Docker execution daemon.
 */
export const highstate = defineUnit({
  type: "k8s.apps.highstate.v1",
  args: {
    ...appName("highstate"),
    ...pick(sharedArgs, ["fqdn"]),
    image: pinnedImage,
    dockerImage: pinnedImage,
    storageSize: z.string().default("20Gi"),
    storageClassName: z.string().optional(),
    initialAdminUserIds: z.array(z.string().min(1)).default([]),
    initialAdminGroupIds: z.array(z.string().min(1)).default([]),
    /**
     * Start stopped when restoring a backup.
     */
    maintenance: z.boolean().default(false),
  },
  secrets: {
    backendIdentity: z.string().startsWith("AGE-SECRET-KEY-").optional(),
    backupKey: z.string().min(1).optional(),
  },
  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresql"]),
    ...pick(optionalSharedInputs, ["volume", "resticRepo"]),
    loginProviders: { entity: loginProviderEntity, multiple: true },
  },
  meta: { title: "Highstate", icon: "mdi:layers-triple", category: "Infrastructure" },
  source: source("highstate"),
})
