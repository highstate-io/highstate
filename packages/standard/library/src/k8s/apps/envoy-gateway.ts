import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { gatewayEntity } from "../../common"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Envoy Gateway controller and gateway implementation.
 */
export const envoyGateway = defineUnit({
  type: "k8s.apps.envoy-gateway.v1",

  args: {
    ...appName("envoy-gateway"),
    ...pick(sharedArgs, ["external", "replicas", "values", "patches", "service", "scheduling"]),

    /**
     * The name of the GatewayClass to configure for Gateway API resources.
     *
     * Defaults to "envoy-gateway".
     */
    className: z.string().default("envoy-gateway"),

    /**
     * The Gateway API controller name for Envoy Gateway.
     */
    controllerName: z.string().default("gateway.envoyproxy.io/gatewayclass-controller"),

    /**
     * Whether to install CRDs bundled with the Envoy Gateway Helm chart.
     */
    installCrds: z.boolean().default(true),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
  },

  outputs: {
    gateway: gatewayEntity,
  },

  meta: {
    title: "Envoy Gateway",
    icon: "simple-icons:envoyproxy",
    iconColor: "#AC6199",
    category: "Network",
  },

  source: source("envoy-gateway"),
})
