import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedInputs, source } from "./shared"

/**
 * The Gitea Git server deployed on Kubernetes.
 */
export const gitea = defineUnit({
  type: "k8s.apps.gitea.v1",

  args: {
    ...appName("gitea"),
  },
  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "mariadbDatabase"]),
  },

  meta: {
    title: "Gitea",
    icon: "simple-icons:gitea",
    category: "Development",
  },

  source: source("gitea"),
})
