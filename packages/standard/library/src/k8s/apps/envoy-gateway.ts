import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { gatewayEntity } from "../../common"
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * The Envoy Gateway controller and gateway implementation.
 */
export const envoyGateway = defineUnit({
  type: "k8s.apps.envoy-gateway.v1",

  args: {
    ...appName("envoy-gateway"),
    ...pick(sharedArgs, ["external", "replicas", "values"]),

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
     * The node selector to apply to Envoy Gateway controller pods.
     */
    nodeSelector: z.record(z.string(), z.string()).default({}),

    /**
     * Whether to install CRDs bundled with the Envoy Gateway Helm chart.
     */
    installCrds: z.boolean().default(true),

    /**
     * The extra patch to the Envoy Gateway controller service.
     */
    service: z.record(z.string(), z.unknown()).default({}),
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
    title: "Envoy Gateway",
    icon: "simple-icons:envoyproxy",
    iconColor: "#AC6199",
    category: "Network",
  },

  source: source("envoy-gateway"),
})
