import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Zitadel IAM deployed on Kubernetes.
 */
export const zitadel = defineUnit({
  type: "k8s.apps.zitadel.v1",

  args: {
    ...appName("zitadel"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresql"]),
  },

  meta: {
    title: "Zitadel",
    icon: "hugeicons:access",
  },

  source: source("zitadel"),
})
