import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, optionalSharedInputs, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Portal application deployed on Kubernetes.
 */
export const portal = defineUnit({
  type: "k8s.apps.portal.v1",

  args: {
    ...appName("portal"),
    ...pick(sharedArgs, ["fqdn", "dnsChallengeAlias"]),
  },

  inputs: {
    ...pick(optionalSharedInputs, ["namespace"]),
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  meta: {
    title: "Portal",
    icon: "mdi:application-outline",
    category: "Services",
  },

  source: source("portal"),
})
