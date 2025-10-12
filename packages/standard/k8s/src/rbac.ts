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
} from "@highstate/pulumi"
import { KubeConfig } from "@kubernetes/client-node"
import { core, rbac, type types } from "@pulumi/kubernetes"
import { map, unique } from "remeda"
import { stringify } from "yaml"
import { Secret } from "./secret"
import { getNamespaceName, getProvider, type NamespaceLike, type ScopedResource } from "./shared"

export type ClusterAccessScopeArgs = {
  /**
   * The namespace to locate the ServiceAccount in.
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
   * Whether to create `ClusterRoleBinding` to bind the `ServiceAccount` to the `ClusterRole`.
   *
   * This will allow the `ServiceAccount` to access all namespaces and cluster resources.
   */
  clusterWide?: boolean
}

export type ClusterAccessScopeForResourcesArgs = {
  /**
   * The namespace to locate the `ServiceAccount` in.
   */
  namespace: Input<Namespace>

  /**
   * The verbs to allow on the resources.
   */
  verbs: string[]

  /**
   * The resources to allow verbs on.
   */
  resources: InputArray<ScopedResource>

  /**
   * Whether to allow access on the whole collection rather than specific resources.
   *
   * The provided resources in this case will be used to determine the types and api groups only.
   */
  collectionAccess?: boolean
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
            name: interpolate`highstate.${namespaceName}.${name}`,
            annotations: {
              "kubernetes.io/description": interpolate`Created by Highstate for the ServiceAccount "${name}" in the namespace "${namespaceName}".`,
            },
          },
          rules: normalizeInputs(args.rule, args.rules),
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

      if (args.allowOriginNamespace ?? true) {
        createRoleBinding(namespaceName)
      }

      output(args.extraNamespaces ?? [])
        .apply(map(getNamespaceName))
        .apply(map(createRoleBinding))

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

  /**
   * Creates `ClusterAccessScope` for the given resources with the specified verbs.
   *
   * All resources must belong to the same namespace in the same cluster.
   *
   * @param name The name of the resource and the ServiceAccount.
   * @param resources The resources to create access scope for.
   * @param verbs The verbs to allow on the resources.
   */
  static async forResources(
    name: string,
    args: ClusterAccessScopeForResourcesArgs,
    opts?: ComponentResourceOptions,
  ): Promise<ClusterAccessScope> {
    const resolved = await toPromise(
      output(args.resources).apply(resources =>
        resources.map(r => ({
          namespaceId: r.namespace.metadata.uid,
          namespace: r.namespace,
          metadata: r.metadata,
          apiVersion: r.apiVersion,
          kind: r.kind,
        })),
      ),
    )

    if (resolved.length === 0) {
      throw new Error("No resources provided to forResources.")
    }

    if (unique(resolved.map(r => r.namespaceId)).length > 1) {
      throw new Error("All resources must belong to the same namespace.")
    }

    const saNamespaceId = await toPromise(output(args.namespace).metadata.uid)

    if (resolved[0].namespaceId !== saNamespaceId) {
      throw new Error("The resources must belong to the same namespace as the ServiceAccount.")
    }

    if (args.collectionAccess) {
      // when collection access is requested, we only need to know the types and api groups
      const uniqueTypes = unique(resolved.map(r => `${r.apiVersion}::${r.kind}`))

      return new ClusterAccessScope(
        name,
        {
          namespace: args.namespace,
          rules: uniqueTypes.map(t => {
            const [apiVersion, kind] = t.split("::")

            return {
              apiGroups: apiVersion === "v1" ? [""] : [apiVersion.split("/")[0]],
              resources: [`${kind.toLowerCase()}s`],
              verbs: args.verbs,
            }
          }),
        },
        opts,
      )
    }

    return new ClusterAccessScope(
      name,
      {
        namespace: args.namespace,
        rules: resolved.map(r => ({
          apiGroups: r.apiVersion === "v1" ? [""] : [r.apiVersion.split("/")[0]],
          resources: [r.kind.toLowerCase() + (r.metadata?.name ? "s" : "")],
          resourceNames: r.metadata?.name ? [r.metadata.name] : undefined,
          verbs: args.verbs,
        })),
      },
      opts,
    )
  }
}
