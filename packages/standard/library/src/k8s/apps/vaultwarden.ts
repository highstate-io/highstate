import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Vaultwarden password manager deployed on Kubernetes.
 */
export const vaultwarden = defineUnit({
  type: "k8s.apps.vaultwarden.v1",

  args: {
    ...appName("vaultwarden"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  secrets: {
    mariadbPassword: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "mariadbDatabase"]),
  },

  meta: {
    title: "Vaultwarden",
    icon: "simple-icons:vaultwarden",
    category: "Security",
  },

  source: source("vaultwarden"),
})
