import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Portal application deployed on Kubernetes.
 */
export const portal = defineUnit({
  type: "k8s.apps.portal.v1",

  args: {
    ...appName("portal"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  meta: {
    title: "Portal",
    icon: "mdi:application-outline",
    category: "Services",
  },

  source: source("portal"),
})
