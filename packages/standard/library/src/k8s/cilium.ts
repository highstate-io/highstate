import { defineUnit, z } from "@highstate/contract"
import { clusterEntity } from "./shared"

/**
 * The Cilium CNI deployed on Kubernetes.
 */
export const cilium = defineUnit({
  type: "k8s.cilium.v1",

  args: {
    /**
     * If set to `true`, the generated network policy will allow
     * all DNS queries to be resolved, even if they are
     * for forbidden (non-allowed) FQDNs.
     *
     * By default, is `false`.
     */
    allowForbiddenFqdnResolution: z.boolean().default(false),

    /**
     * Whether to enable Hubble Relay and UI for observability.
     *
     * By default, this is `true`.
     *
     * To expose the Hubble UI, you can use `k8s.apps.hubble-ui` unit.
     */
    enableHubble: z.boolean().default(true),
  },

  inputs: {
    k8sCluster: clusterEntity,
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Cilium",
    icon: "simple-icons:cilium",
    secondaryIcon: "devicon:kubernetes",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/cilium",
    path: "unit",
  },
})

export const ciliumClusterMetadata = z.object({
  cilium: z.object({
    /**
     * If set to `true`, the generated network policy will allow
     * all DNS queries to be resolved, even if they are
     * for forbidden (non-allowed) FQDNs.
     *
     * By default, is `false`.
     */
    allowForbiddenFqdnResolution: z.boolean().default(false),
  }),
})

export type CiliumClusterMetadata = z.infer<typeof ciliumClusterMetadata>
