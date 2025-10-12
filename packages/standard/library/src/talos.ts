import { defineEntity, defineUnit, z } from "@highstate/contract"
import { clusterInputs, clusterOutputs, scheduleOnMastersPolicyArgs } from "./k8s/shared"

export const clusterEntity = defineEntity({
  type: "talos.cluster.v1",

  schema: z.object({
    clientConfiguration: z.string(),
    machineSecrets: z.string(),
  }),

  meta: {
    color: "#2d2d2d",
  },
})

export const cniSchema = z.enum(["none", "cilium", "flannel"])
export const csiSchema = z.enum(["none", "local-path-provisioner"])

/**
 * The Talos cluster created on top of the server.
 */
export const cluster = defineUnit({
  type: "talos.cluster.v1",

  args: {
    ...scheduleOnMastersPolicyArgs,

    /**
     * The name of the cluster.
     *
     * By default, the name of the instance is used.
     */
    clusterName: z.string().optional(),

    /**
     * The CNI plugin to use.
     *
     * The following options are available:
     * - "cilium" (default)
     * - "flannel" (built-in in Talos)
     * - "none" (disable CNI, must be installed manually)
     *
     * The "cilium" CNI plugin is recommended to cover advanced network policies like FQDNs.
     */
    cni: cniSchema.default("cilium"),

    /**
     * The CSI plugin to use.
     *
     * The following options are available:
     * - "local-path-provisioner" (default)
     * - "none" (disable CSI, must be installed manually if needed)
     */
    csi: csiSchema.default("local-path-provisioner"),

    /**
     * The shared configuration patch.
     * It will be applied to all nodes.
     */
    sharedConfigPatch: z.record(z.string(), z.any()).optional(),

    /**
     * The master configuration patch.
     * It will be applied to all master nodes.
     */
    masterConfigPatch: z.record(z.string(), z.any()).optional(),

    /**
     * The worker configuration patch.
     * It will be applied to all worker nodes.
     */
    workerConfigPatch: z.record(z.string(), z.any()).optional(),

    /**
     * Whether to enable the Tun device plugin.
     *
     * There is the only option for Talos to get tun device in containers.
     *
     * By default, this option is set to true.
     */
    enableTunDevicePlugin: z.boolean().default(true),
  },

  inputs: clusterInputs,

  outputs: {
    ...clusterOutputs,
    talosCluster: clusterEntity,
  },

  meta: {
    title: "Talos Cluster",
    category: "Talos",
    color: "#2d2d2d",
    icon: "simple-icons:talos",
    secondaryIcon: "devicon:kubernetes",
  },

  source: {
    package: "@highstate/talos",
    path: "cluster",
  },
})
