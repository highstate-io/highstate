import type { k8s } from "@highstate/library"
import { getOrCreate } from "@highstate/contract"
import { toPromise } from "@highstate/pulumi"
import { core, type types } from "@pulumi/kubernetes"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  type Output,
  output,
  type Unwrap,
} from "@pulumi/pulumi"
import {
  getProvider,
  mapMetadata,
  Resource,
  type ScopedResourceArgs,
  validateCluster,
} from "./shared"

export type NamespaceArgs = Omit<ScopedResourceArgs, "namespace"> & {
  /**
   * The cluster where the namespace is located.
   */
  cluster: Input<k8s.Cluster>

  /**
   * Whether to apply "pod-security.kubernetes.io/enforce=privileged" label to the namespace.
   */
  privileged?: boolean
}

export type CreateOrGetNamespaceArgs = NamespaceArgs & {
  /**
   * The resource to use to determine the name of the namespace.
   *
   * If not provided, the namespace will be created, otherwise it will be retrieved/patched.
   */
  resource?: Input<k8s.NamespacedResource>

  /**
   * The namespace entity to patch/retrieve.
   */
  existing?: Input<k8s.Namespace> | undefined
}

export abstract class Namespace extends Resource {
  constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    cluster: Output<k8s.Cluster>,
    metadata: Output<types.output.meta.v1.ObjectMeta>,

    /**
     * The spec of the underlying Kubernetes namespace.
     */
    readonly spec: Output<types.output.core.v1.NamespaceSpec>,

    /**
     * The status of the underlying Kubernetes namespace.
     */
    readonly status: Output<types.output.core.v1.NamespaceStatus>,
  ) {
    super(type, name, args, opts, cluster, metadata)
  }

  /**
   * The Highstate namespace entity.
   */
  get entity(): Output<k8s.Namespace> {
    return output(this.entityBase)
  }

  /**
   * Creates a new namespace.
   */
  static create(name: string, args: NamespaceArgs, opts?: ComponentResourceOptions): Namespace {
    return new CreatedNamespace(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes namespace.
   */
  static wrap(
    name: string,
    args: WrappedNamespaceArgs,
    opts?: ComponentResourceOptions,
  ): Namespace {
    return new WrappedNamespace(name, args, opts)
  }

  /**
   * Creates a new namespace or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the namespace name. Will not be used when existing namespace is retrieved.
   * @param args The arguments to create or get the namespace with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetNamespaceArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Namespace> {
    if (args.resource) {
      return await Namespace.forResourceAsync(args.resource, args.cluster)
    }

    if (args.existing) {
      return await Namespace.forAsync(args.existing, args.cluster)
    }

    return new CreatedNamespace(name, args, opts)
  }

  /**
   * Creates a new namespace or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the namespace name.
   * @param args The arguments to create or patch the namespace with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetNamespaceArgs,
    opts?: ComponentResourceOptions,
  ): Namespace {
    if (args.resource) {
      return new NamespacePatch(name, {
        ...args,
        name: output(args.resource).metadata.namespace,
        cluster: validateCluster(args.resource, args.cluster),
      })
    }

    if (args.existing) {
      return new NamespacePatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        cluster: validateCluster(args.existing, args.cluster),
      })
    }

    return new CreatedNamespace(name, args, opts)
  }

  /**
   * Patches an existing namespace.
   *
   * Will throw an error if the namespace does not exist.
   *
   * @param name The name of the resource. May not be the same as the namespace name.
   * @param args The arguments to patch the namespace with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: NamespaceArgs, opts?: ComponentResourceOptions): Namespace {
    return new NamespacePatch(name, args, opts)
  }

  /**
   * Gets an existing namespace.
   *
   * Will throw an error if the namespace does not exist.
   *
   * @param name The name of the resource. May not be the same as the namespace name.
   * @param args The arguments to get the namespace with.
   * @param opts Optional resource options.
   */
  static get(
    name: string,
    args: ExternalNamespaceArgs,
    opts?: ComponentResourceOptions,
  ): Namespace {
    return new ExternalNamespace(name, args, opts)
  }

  private static readonly namespaceCache = new Map<string, Namespace>()

  /**
   * Gets an existing namespace for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{clusterId}`.
   *
   * This method it idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the namespace for.
   * @param cluster The cluster where the namespace is located.
   */
  static for(entity: k8s.Namespace, cluster: Input<k8s.Cluster>): Namespace {
    return getOrCreate(
      Namespace.namespaceCache,
      `${entity.clusterName}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Namespace.get(name, {
          name: entity.metadata.name,
          cluster: validateCluster(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing namespace for a given entity.
   * Prefer this method over `get` when possible.
   *
   * @param entity The entity to get the namespace for.
   * @param cluster The cluster where the namespace is located.
   */
  static async forAsync(
    entity: Input<k8s.Namespace>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Namespace> {
    const resolvedEntity = await toPromise(entity)

    return Namespace.for(resolvedEntity, cluster)
  }

  /**
   * Gets an existing namespace where the provided resource is located.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{clusterId}`.
   *
   * This method it idempotent and will return the same instance for the same resource.
   *
   * @param resource The resource to get the namespace for.
   * @param cluster The cluster where the namespace is located.
   */
  static forResource(resource: k8s.NamespacedResource, cluster: Input<k8s.Cluster>): Namespace {
    return getOrCreate(
      Namespace.namespaceCache,
      `${resource.clusterName}.${resource.metadata.namespace}.${resource.clusterId}`,
      name => {
        return Namespace.get(name, {
          name: resource.metadata.namespace,
          cluster: validateCluster(resource, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing namespace for a given entity.
   * Prefer this method over `get` when possible.
   *
   * @param resource The resource to get the namespace for.
   * @param cluster The cluster where the namespace is located.
   */
  static async forResourceAsync(
    resource: Input<k8s.NamespacedResource>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Namespace> {
    const resolvedResource = await toPromise(resource)

    return Namespace.forResource(resolvedResource, cluster)
  }
}

function mapNamespaceMetadata(
  args: NamespaceArgs,
  fallbackName: string,
): Output<Unwrap<types.input.meta.v1.ObjectMeta>> {
  return mapMetadata(args, fallbackName).apply(metadata => {
    if (args.privileged) {
      metadata.labels = {
        ...metadata.labels,
        "pod-security.kubernetes.io/enforce": "privileged",
      }
    }

    return metadata
  })
}

class CreatedNamespace extends Namespace {
  constructor(name: string, args: NamespaceArgs, opts?: ComponentResourceOptions) {
    const namespace = output(args.cluster).apply(cluster => {
      return new core.v1.Namespace(
        name,
        { metadata: mapNamespaceMetadata(args, name) },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Namespace",
      name,
      args,
      opts,
      output(args.cluster),
      namespace.metadata,
      namespace.spec,
      namespace.status,
    )
  }
}

class NamespacePatch extends Namespace {
  constructor(name: string, args: NamespaceArgs, opts?: ComponentResourceOptions) {
    const namespace = output(args.cluster).apply(cluster => {
      return new core.v1.NamespacePatch(
        name,
        { metadata: mapNamespaceMetadata(args, name) },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:NamespacePatch",
      name,
      args,
      opts,
      output(args.cluster),
      namespace.metadata,
      namespace.spec,
      namespace.status,
    )
  }
}

export type WrappedNamespaceArgs = {
  /**
   * The underlying Kubernetes namespace to wrap.
   */
  namespace: Input<core.v1.Namespace>

  /**
   * The cluster where the namespace is located.
   */
  cluster: Input<k8s.Cluster>
}

export type ExternalNamespaceArgs = {
  /**
   * The real name of the namespace in the cluster.
   */
  name: Input<string>

  /**
   * The cluster where the namespace is located.
   */
  cluster: Input<k8s.Cluster>
}

class ExternalNamespace extends Namespace {
  constructor(name: string, args: ExternalNamespaceArgs, opts?: ComponentResourceOptions) {
    const namespace = output(args.cluster).apply(cluster => {
      return core.v1.Namespace.get(name, args.name, {
        ...opts,
        parent: this,
        provider: getProvider(cluster),
      })
    })

    super(
      "highstate:k8s:ExternalNamespace",
      name,
      args,
      opts,
      output(args.cluster),
      namespace.metadata,
      namespace.spec,
      namespace.status,
    )
  }
}

class WrappedNamespace extends Namespace {
  constructor(name: string, args: WrappedNamespaceArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedNamespace",
      name,
      args,
      opts,

      output(args.cluster),
      output(args.namespace).metadata,
      output(args.namespace).spec,
      output(args.namespace).status,
    )
  }
}
