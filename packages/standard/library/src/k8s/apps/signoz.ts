import { defineUnit } from "@highstate/contract"
import { pick } from "remeda"
import { serviceEntity } from "../service"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * SigNoz deployed on Kubernetes.
 */
export const signoz = defineUnit({
  type: "k8s.apps.signoz.v1",

  args: {
    ...appName("signoz"),
    ...pick(sharedArgs, ["fqdn", "namespace", "values", "patches", "service", "scheduling"]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint", "postgresql"]),
  },

  outputs: {
    service: serviceEntity,
  },

  meta: {
    title: "SigNoz",
    icon: "selfhst:signoz",
    category: "Observability",
  },

  source: source("signoz"),
})
