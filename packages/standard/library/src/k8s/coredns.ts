import { defineUnit, z } from "@highstate/contract"
import { clusterEntity, schedulingArg } from "./shared"

/**
 * The CoreDNS cluster DNS service installed on the Kubernetes cluster.
 */
export const coreDns = defineUnit({
  type: "k8s.coredns.v1",

  args: {
    ...schedulingArg,

    /**
     * The mode to use for CoreDNS deployment.
     *
     * `cluster` creates a regular Deployment with a small replica count.
     * It is the default Kubernetes model and fits clusters with reliable pod/service networking between nodes.
     *
     * `node` creates a DaemonSet and configures the DNS Service to route only to node-local endpoints.
     * It fits edge, NATed, or partitioned clusters where each node should answer DNS locally and avoid cross-node DNS traffic.
     */
    mode: z.enum(["cluster", "node"]).default("cluster"),

    /**
     * The Kubernetes cluster DNS domain served by CoreDNS.
     */
    clusterDomain: z.string().default("cluster.local"),

    /**
     * The stable Service IP to reserve for cluster DNS.
     *
     * The default matches the common K3s service CIDR.
     */
    clusterIP: z.string().default("10.43.0.10"),

    /**
     * Whether CoreDNS should connect through the best external Kubernetes API endpoint.
     *
     * By default, CoreDNS uses the in-cluster Kubernetes service endpoint.
     */
    useExternalKubeApi: z.boolean().default(false),
  },

  inputs: {
    k8sCluster: clusterEntity,
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "CoreDNS",
    icon: "selfhst:coredns-light",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/coredns",
  },
})
