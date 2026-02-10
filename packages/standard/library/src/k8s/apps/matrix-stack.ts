import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import { appName, sharedInputs, source } from "./shared"

/**
 * The Matrix stack deployed on Kubernetes.
 */
export const matrixStack = defineUnit({
  type: "k8s.apps.matrix-stack.v1",

  args: {
    ...appName("matrix-stack"),

    /**
     * The base domain for the Matrix stack services.
     *
     * Subdomains like synapse.<fqdn> and element.<fqdn> are generated automatically.
     * This value cannot be changed after the first deployment.
     */
    fqdn: {
      schema: z.string(),
    },
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  outputs: {
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Matrix Stack",
    icon: "simple-icons:matrixdotorg",
    secondaryIcon: "simple-icons:element",
    category: "Communication",
  },

  source: source("matrix-stack"),
})
