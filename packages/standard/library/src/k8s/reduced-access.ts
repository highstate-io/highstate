import { defineUnit, z } from "@highstate/contract"
import { namespaceEntity, resourceEntity } from "./resources"
import { clusterEntity } from "./shared"

export const accessVerbSchema = z.enum([
  "get",
  "list",
  "watch",
  "create",
  "update",
  "patch",
  "delete",
  "deletecollection",
])

export const acessRuleSchema = z.object({
  apiGroups: z.string().array(),
  resources: z.string().array(),
  verbs: accessVerbSchema.array(),
  resourceNames: z.string().array().default([]),
})

/**
 * Creates a reduced access cluster with ServiceAccount-based authentication for specific Kubernetes resources.
 */
export const reducedAccessCluster = defineUnit({
  type: "k8s.reduced-access-cluster.v1",

  args: {
    /**
     * The name of the ServiceAccount to create.
     *
     * If not provided, will be the same as the unit name.
     */
    serviceAccountName: z.string().optional(),

    /**
     * The rules defining the access permissions for the ServiceAccount.
     *
     * If rule's `apiGroups` and `resources` exactly match resources from the `resources` input,
     * their names will be added to the rule's `resourceNames` list.
     */
    rules: acessRuleSchema.array().default([]),
  },

  inputs: {
    k8sCluster: clusterEntity,

    /**
     * The namespace where the ServiceAccount will be created.
     */
    namespace: namespaceEntity,

    /**
     * The extra namespaces to bind to the ClusterRole and allow ServiceAccount to access them with specified rules.
     */
    extraNamespaces: {
      entity: namespaceEntity,
      multiple: true,
      required: false,
    },

    /**
     * The resources to which access will be granted.
     */
    resources: {
      entity: resourceEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Reduced Access Cluster",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:shield-lock",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/reduced-access-cluster",
  },
})
