import { defineUnit } from "@highstate/contract"
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
 * The Grocy application deployed on Kubernetes.
 *
 * Grocy is a web-based self-hosted groceries & household management solution for your home.
 */
export const grocy = defineUnit({
  type: "k8s.apps.grocy.v1",

  args: {
    ...appName("grocy"),
    ...pick(sharedArgs, ["fqdn"]),
  },
  secrets: {
    ...pick(sharedSecrets, ["backupKey"]),
  },
  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
    ...pick(optionalSharedInputs, ["resticRepo"]),
  },

  meta: {
    title: "Grocy",
    icon: "simple-icons:grocy",
    category: "Productivity",
  },

  source: source("grocy"),
})
