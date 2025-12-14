import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { gatewayEntity } from "../../common"
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Traefik instance + gateway implementation.
 */
export const traefik = defineUnit({
  type: "k8s.apps.traefik.v1",

  args: {
    ...appName("traefik"),
    ...pick(sharedArgs, ["external", "replicas", "endpoints"]),

    /**
     * The name of the class to configure for ingress and gateway resources.
     *
     * Defaults to "traefik".
     */
    className: z.string().default("traefik"),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
  },

  outputs: {
    gateway: gatewayEntity,
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Traefik Gateway",
    icon: "simple-icons:traefikproxy",
    category: "Network",
  },

  source: source("traefik"),
})
