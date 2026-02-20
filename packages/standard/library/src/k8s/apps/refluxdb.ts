import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { appName, sharedArgs, sharedInputs, sharedSecrets, source } from "./shared"
import { influxdb3, s3 } from "../../databases"
import { deploymentEntity } from "../workload"

/**
 * The RefluxDB instance deployed on Kubernetes.
 */
export const refluxdb = defineUnit({
  type: "k8s.apps.refluxdb.v1",

  args: {
    ...appName("refluxdb"),
    ...pick(sharedArgs, ["external"]),

    /**
     * The ID of the node.
     *
     * Defaults to "local1".
     */
    nodeId: z.string().default("local1"),
  },

  secrets: {
    /**
     * The operator token of the RefluxDB instance.
     */
    operatorToken: z.string().optional(),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
    s3Bucket: s3.bucketEntity,
  },

  outputs: {
    connection: influxdb3.connectionEntity,
    deployment: deploymentEntity,
  },

  meta: {
    title: "RefluxDB (InfluxDB 3)",
    icon: "simple-icons:influxdb",
    category: "Databases",
  },

  source: source("refluxdb"),
})
