import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * Exposes Hubble UI to the user.
 *
 * It must be already installed in the cluster as part of the Cilium.
 */
export const hubble = defineUnit({
  type: "k8s.apps.hubble.v1",

  args: {
    ...appName("hubble"),
    ...pick(sharedArgs, ["fqdn"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  meta: {
    title: "Hubble",
    icon: "mdi:eye",
    secondaryIcon: "simple-icons:cilium",
    category: "Observability",
  },

  source: source("hubble"),
})
