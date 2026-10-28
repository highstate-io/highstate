import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { providerEntity } from "../../oauth"
import { managementEntity } from "../../zitadel"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Zitadel IAM deployed on Kubernetes.
 */
export const zitadel = defineUnit({
  type: "k8s.apps.zitadel.v1",

  args: {
    ...appName("zitadel"),
    ...pick(sharedArgs, ["scheduling"]),
    fqdn: z.hostname(),
    /**
     * Official chart version; changing it explicitly controls upgrades.
     */
    chartVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default("10.4.0"),
    imageTag: z.string().min(1).default("v4.19.2"),
    loginImageTag: z.string().min(1).default("v4.19.2"),
    replicas: z.number().int().positive().default(1),
    organizationName: z.string().min(1).default("Zitadel"),
    adminEmail: z.email(),
    adminFirstName: z.string().min(1).default("Zitadel"),
    adminLastName: z.string().min(1).default("Admin"),
    /**
     * Bootstrap-only expiry; existing PATs must be rotated in ZITADEL and imported.
     */
    managementTokenExpiration: z.iso.datetime().default("2029-01-01T00:00:00Z"),
  },

  secrets: {
    masterKey: z
      .string()
      .regex(/^[\x20-\x7e]{32}$/)
      .optional(),
    adminPassword: z.string().min(8).optional(),
    /**
     * Overrides the bootstrap PAT, for existing databases or credential rotation.
     */
    managementToken: z.string().min(1).optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresql"]),
  },

  outputs: { provider: providerEntity, management: managementEntity },

  meta: {
    title: "Zitadel",
    icon: "hugeicons:access",
  },

  source: source("zitadel"),
})
