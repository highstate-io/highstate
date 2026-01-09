import type { PartialKeys } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  type Output,
  output,
  secret,
  toPromise,
  type Unwrap,
} from "@highstate/pulumi"
import { core, Provider, type types } from "@pulumi/kubernetes"
import * as images from "../assets/images.json"
import { Namespace } from "./namespace"

const providers = new Map<`${string}.${string}`, Provider>()

export function getProvider(cluster: k8s.Cluster): Provider {
  const name = `${cluster.name}.${cluster.connectionId}` as const
  const existing = providers.get(name)
  if (existing) {
    return existing
  }

  const provider = new Provider(name, { kubeconfig: secret(cluster.kubeconfig) })
  providers.set(name, provider)

  return provider
}

export async function getProviderAsync(cluster: Input<k8s.Cluster>): Promise<Provider> {
  const resolvedCluster = await toPromise(cluster)

  return getProvider(resolvedCluster)
}

export type NamespaceLike = core.v1.Namespace | Namespace | string

export type ScopedResourceArgs = {
  /**
   * The name of the resource.
   */
  name?: Input<string>

  /**
   * The namespace to create the resource in.
   */
  namespace: Input<Namespace>

  /**
   * The metadata to apply to the resource.
   */
  metadata?: Input<types.input.meta.v1.ObjectMeta>
}

export const commonExtraArgs = ["name", "namespace", "metadata"] as const

export function mapMetadata(
  args: PartialKeys<ScopedResourceArgs, "namespace">,
  fallbackName?: string,
): Output<Unwrap<types.input.meta.v1.ObjectMeta>> {
  return output(args.metadata).apply(metadata =>
    output({
      ...metadata,
      name: args.name ?? metadata?.name ?? fallbackName,
      namespace:
        metadata?.namespace ?? (args.namespace ? output(args.namespace).metadata.name : undefined),
    }),
  )
}

export type SelectorLike = types.input.meta.v1.LabelSelector | Record<string, Input<string>>

export function mapSelectorLikeToSelector(
  selector: SelectorLike,
): types.input.meta.v1.LabelSelector {
  if ("matchLabels" in selector || "matchExpressions" in selector) {
    return selector
  }

  return {
    matchLabels: selector as Record<string, Input<string>>,
  }
}

export function getNamespaceName(namespace: NamespaceLike): Output<string> {
  if (Namespace.isInstance(namespace)) {
    return namespace.metadata.name
  }

  if (core.v1.Namespace.isInstance(namespace)) {
    return namespace.metadata.name
  }

  return output(namespace)
}

export function mapNamespaceNameToSelector(
  namespace: Input<string>,
): types.input.meta.v1.LabelSelector {
  return {
    matchLabels: {
      "kubernetes.io/metadata.name": namespace,
    },
  }
}

export function validateCluster(
  entity: Input<k8s.Resource>,
  cluster: Input<k8s.Cluster>,
): Input<k8s.Cluster> {
  return output({ entity, cluster }).apply(({ entity, cluster }) => {
    if (entity.clusterId !== cluster.id) {
      throw new Error(
        `Cluster mismatch for ${entity.kind} "${entity.metadata.name}": "${entity.clusterId}" != "${cluster.id}"`,
      )
    }

    return cluster
  })
}

export { images }

/**
 * Base class for all Kubernetes resources.
 *
 * Provides common functionality for resources that have a cluster and entity.
 */
export abstract class Resource extends ComponentResource {
  /**
   * The Kubernetes API version (e.g., "v1", "apps/v1", "batch/v1").
   */
  static apiVersion: string

  /**
   * The Kubernetes kind (e.g., "ConfigMap", "Deployment", "CronJob").
   */
  static kind: string

  /**
   * Whether the resource is namespaced.
   */
  static isNamespaced = false

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    /**
     * The cluster where the resource is located.
     */
    readonly cluster: Output<k8s.Cluster>,

    /**
     * The metadata of the underlying Kubernetes resource.
     */
    readonly metadata: Output<types.output.meta.v1.ObjectMeta>,
  ) {
    super(type, name, args, opts)
  }

  /**
   * The Kubernetes API version (e.g., "v1", "apps/v1", "batch/v1").
   */
  get apiVersion() {
    return (this.constructor as typeof Resource).apiVersion
  }

  /**
   * The Kubernetes kind (e.g., "ConfigMap", "Deployment", "CronJob").
   */
  get kind() {
    return (this.constructor as typeof Resource).kind
  }

  get isNamespaced() {
    return (this.constructor as typeof Resource).isNamespaced
  }

  protected get entityBase() {
    return {
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      apiVersion: this.apiVersion,
      kind: this.kind,
      isNamespaced: false,
      metadata: this.metadata,
    }
  }
}

/**
 * Base class for all Kubernetes namespaced resources.
 *
 * Provides common functionality for resources that have a cluster, namespace, metadata, and entity.
 */
export abstract class NamespacedResource extends Resource {
  static isNamespaced = true

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,
    metadata: Output<types.output.meta.v1.ObjectMeta>,

    /**
     * The namespace where the resource is located.
     */
    readonly namespace: Output<Namespace>,
  ) {
    super(type, name, args, opts, namespace.cluster, metadata)
  }

  /**
   * The Highstate resource entity.
   */
  abstract get entity(): Output<k8s.NamespacedResource>
}
