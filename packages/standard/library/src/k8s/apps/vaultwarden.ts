import { defineUnit } from "@highstate/contract"
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

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "mysql"]),
  },

  meta: {
    title: "Vaultwarden",
    icon: "simple-icons:vaultwarden",
    category: "Security",
  },

  source: source("vaultwarden"),
})
