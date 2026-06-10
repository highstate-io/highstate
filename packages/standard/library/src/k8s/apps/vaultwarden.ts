import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import {
  appName,
  optionalSharedInputs,
  sharedArgs,
  sharedInputs,
  sharedSecrets,
  source,
} from "./shared"

/**
 * The Vaultwarden password manager deployed on Kubernetes.
 */
export const vaultwarden = defineUnit({
  type: "k8s.apps.vaultwarden.v1",

  args: {
    ...appName("vaultwarden"),
    ...pick(sharedArgs, ["fqdn"]),

    /**
     * Whether signup is allowed for the Vaultwarden instance. Defaults to `false` for security reasons.
     */
    allowSignup: z.boolean().default(false),

    /**
     * Whether admin panel is enabled. Defaults to `true`.
     */
    enableAdminPanel: z.boolean().default(true),
  },

  secrets: {
    /**
     * The admin token for the Vaulwarden instance.
     *
     * Will be automatically generated if `enableAdminPanel` is `true`.
     */
    adminToken: z.string().optional(),

    ...pick(sharedSecrets, ["backupKey"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "mysql"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  meta: {
    title: "Vaultwarden",
    icon: "simple-icons:vaultwarden",
    category: "Security",
  },

  source: source("vaultwarden"),
})
