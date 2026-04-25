import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { serviceEntity } from "../service"
import { appName, sharedArgs, sharedInputs, source } from "./shared"

/**
 * Grafana deployed on Kubernetes.
 */
export const grafana = defineUnit({
  type: "k8s.apps.grafana.v1",

  args: {
    ...appName("grafana"),
    ...pick(sharedArgs, ["fqdn"]),

    /**
     * The list of plugins to install on Grafana.
     *
     * See https://grafana.com/grafana/plugins for available plugins and their names.
     */
    plugins: z.string().array().default([]),
  },

  secrets: {
    /**
     * The admin password used for Grafana.
     *
     * If not provided, a random password will be generated.
     */
    adminPassword: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),
  },

  outputs: {
    service: serviceEntity,
  },

  meta: {
    title: "Grafana",
    icon: "simple-icons:grafana",
    category: "Observability",
  },

  source: source("grafana"),
})
