import type { k8s } from "@highstate/library"
import type { Namespace } from "./namespace"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  interpolate,
  normalizeInputs,
  type Output,
  output,
  toPromise,
  type Unwrap,
} from "@highstate/pulumi"
import { KubeConfig } from "@kubernetes/client-node"
import { core, rbac, type types } from "@pulumi/kubernetes"
import { map, unique } from "remeda"
import { stringify } from "yaml"
import { Secret } from "./secret"
import {
  getNamespaceName,
  getProvider,
  type Resource,
  NamespacedResource,
  type NamespaceLike,
} from "./shared"

export type ClusterAccessScopeArgs = {
  /**
   * The namespace to create the ServiceAccount in.
   */
  namespace: Input<Namespace>

  /**
   * The RBAC rule to apply to the `ServiceAccount`.
   *
   * It will be used to create ClusterRole.
   */
  rule?: Input<types.input.rbac.v1.PolicyRule>

  /**
   * The RBAC rules to apply to the `ServiceAccount`.
   *
   * It will be used to create `ClusterRole`.
   */
  rules?: InputArray<types.input.rbac.v1.PolicyRule>

  /**
   * Whether to allow the `ServiceAccount` to access resources in the namespace where it is created.
   *
   * By default, it is set to `true`.
   */
  allowOriginNamespace?: boolean

  /**
   * The extra namespaces to bind to the `ClusterRole` and allow `ServiceAccount` to access them
   * with specified `rules`.
   */
  extraNamespaces?: InputArray<NamespaceLike>

  /**
   * Whether to create `ClusterRoleBinding` instead of `RoleBinding` to allow cluster-wide access.
   *
   * This will allow the `ServiceAccount` to access all namespaces and cluster resources.
   */
  clusterWide?: boolean

  /**
   * The extra resources to merge into passed rules.
   *
   * Resources will be merged into rule `resourceNames` if they exactly match rule's `apiGroups` and `resources`.
   * If rule specifies multiple apiGroups or resources, resources will not be merged into it.
   */
  resources?: InputArray<Resource | k8s.Resource>
}

export class ClusterAccessScope extends ComponentResource {
  /**
   * The cluster entity with the reduced access.
   */
  readonly cluster: Output<k8s.Cluster>

  constructor(name: string, args: ClusterAccessScopeArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:ClusterAccessScope", name, args, opts)

    const { serviceAccount, kubeconfig } = output(args.namespace).cluster.apply(cluster => {
      const provider = getProvider(cluster)
      const namespaceName = output(args.namespace).metadata.name

      const serviceAccount = new core.v1.ServiceAccount(
        name,
        {
          metadata: {
            name,
            namespace: namespaceName,
          },
        },
        { provider },
      )

      const clusterRole = new rbac.v1.ClusterRole(
        name,
        {
          metadata: {
            name: interpolate`hs.${namespaceName}.${name}`,
            annotations: {
              "kubernetes.io/description": interpolate`Created by Highstate for the ServiceAccount "${name}" in the namespace "${namespaceName}".`,
            },
          },
          rules: output({
            rules: normalizeInputs(args.rule, args.rules),
            resources: args.resources ?? [],
          }).apply(({ rules, resources }) => mergeResources(rules, resources)),
        },
        { provider },
      )

      const createRoleBinding = (namespace: Input<string>) => {
        return new rbac.v1.RoleBinding(
          name,
          {
            metadata: { name, namespace },
            roleRef: {
              kind: "ClusterRole",
              name: clusterRole.metadata.name,
              apiGroup: "rbac.authorization.k8s.io",
            },
            subjects: [
              {
                kind: "ServiceAccount",
                name: serviceAccount.metadata.name,
                namespace: namespaceName,
              },
            ],
          },
          { provider },
        )
      }

      if (args.clusterWide) {
        new rbac.v1.ClusterRoleBinding(
          name,
          {
            metadata: { name },
            roleRef: {
              kind: "ClusterRole",
              name: clusterRole.metadata.name,
              apiGroup: "rbac.authorization.k8s.io",
            },
            subjects: [
              {
                kind: "ServiceAccount",
                name: serviceAccount.metadata.name,
                namespace: namespaceName,
              },
            ],
          },
          { provider },
        )
      } else {
        if (args.allowOriginNamespace !== false) {
          createRoleBinding(namespaceName)
        }

        output(args.extraNamespaces ?? [])
          .apply(map(getNamespaceName))
          .apply(map(createRoleBinding))
      }

      return { serviceAccount, kubeconfig: cluster.kubeconfig }
    })

    const accessTokenSecret = Secret.create(`${name}-token`, {
      namespace: args.namespace,
      type: "kubernetes.io/service-account-token",
      metadata: {
        annotations: {
          "kubernetes.io/service-account.name": serviceAccount.metadata.name,
        },
      },
    })

    this.cluster = output({
      cluster: output(args.namespace).cluster,
      kubeconfig,
      newToken: accessTokenSecret.getValue("token"),
      serviceAccount: serviceAccount.metadata.name,
    }).apply(({ cluster, kubeconfig, newToken, serviceAccount }) => {
      const config = new KubeConfig()
      config.loadFromString(kubeconfig)

      // clear all existing contexts and users
      config.users = []
      config.contexts = []

      config.addUser({ name: serviceAccount, token: newToken })

      config.addContext({
        name: config.clusters[0].name,
        cluster: config.clusters[0].name,
        user: serviceAccount,
      })

      config.setCurrentContext(config.clusters[0].name)

      return {
        ...cluster,
        kubeconfig: stringify(JSON.parse(config.exportConfig())),
      }
    })
  }
}

async function mergeResources(
  rules: Unwrap<types.input.rbac.v1.PolicyRule>[],
  resources: (Resource | k8s.Resource)[],
): Promise<types.input.rbac.v1.PolicyRule[]> {
  for (const resource of resources) {
    const entity = await toPromise(
      resource instanceof NamespacedResource ? resource.entity : resource,
    )

    const apiGroup = entity.apiVersion.includes("/") // e.g., "apps/v1"
      ? entity.apiVersion.split("/")[0]
      : ""

    const resourceCollection = `${entity.kind.toLowerCase()}s`

    const matchingRule = rules.find(rule => {
      const apiGroupsMatch = rule.apiGroups?.length === 1 && rule.apiGroups[0] === apiGroup
      const resourcesMatch =
        rule.resources?.length === 1 && rule.resources[0] === resourceCollection

      return apiGroupsMatch && resourcesMatch
    })

    if (!matchingRule) {
      continue
    }

    matchingRule.resourceNames = unique([
      ...(matchingRule.resourceNames ?? []),
      entity.metadata.name,
    ])
  }

  return rules
}
