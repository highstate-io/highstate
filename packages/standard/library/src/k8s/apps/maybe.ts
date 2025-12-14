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

export const maybe = defineUnit({
  type: "k8s.apps.maybe.v1",

  args: {
    ...appName("maybe"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
    postgresqlPassword: z.string().optional(),
    secretKey: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresql", "redis"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  meta: {
    title: "Maybe",
    description: "The OS for your personal finances.",
    icon: "arcticons:finance-manager",
    category: "Finance",
  },

  source: source("maybe"),
})
