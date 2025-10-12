import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Kubernetes Dashboard deployed on Kubernetes.
 */
export const kubernetesDashboard = defineUnit({
  type: "k8s.apps.kubernetes-dashboard.v1",

  args: {
    ...appName("kubernetes-dashboard"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  meta: {
    title: "Kubernetes Dashboard",
    icon: "devicon:kubernetes",
    secondaryIcon: "material-symbols:dashboard",
    category: "Kubernetes",
  },

  source: source("kubernetes-dashboard"),
})
