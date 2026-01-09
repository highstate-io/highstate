import type { k8s } from "@highstate/library"
import { getOrCreate } from "@highstate/contract"
import { toPromise } from "@highstate/pulumi"
import { core, type types } from "@pulumi/kubernetes"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  type Output,
  output,
} from "@pulumi/pulumi"
import { Namespace } from "./namespace"
import { getProvider, mapMetadata, NamespacedResource, type ScopedResourceArgs } from "./shared"

export type ConfigMapArgs = ScopedResourceArgs &
  Omit<types.input.core.v1.ConfigMap, "kind" | "metadata" | "apiVersion">

export type CreateOrGetConfigMapArgs = ConfigMapArgs & {
  /**
   * The config map entity to patch/retrieve.
   */
  existing: Input<k8s.NamespacedResource> | undefined
}

/**
 * Represents a Kubernetes ConfigMap resource with metadata and data.
 */
export abstract class ConfigMap extends NamespacedResource {
  static apiVersion = "v1"
  static kind = "ConfigMap"

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    /**
     * The data of the underlying Kubernetes config map.
     */
    readonly data: Output<Record<string, string>>,
  ) {
    super(type, name, args, opts, metadata, namespace)
  }

  /**
   * The Highstate config map entity.
   */
  get entity(): Output<k8s.NamespacedResource> {
    return output({
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      apiVersion: this.apiVersion,
      kind: this.kind,
      metadata: this.metadata,
    })
  }

  /**
   * Creates a new config map.
   */
  static create(name: string, args: ConfigMapArgs, opts?: ComponentResourceOptions): ConfigMap {
    return new CreatedConfigMap(name, args, opts)
  }

  /**
   * Creates a new config map or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the config map name.
   * @param args The arguments to create or patch the config map with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetConfigMapArgs,
    opts?: ComponentResourceOptions,
  ): ConfigMap {
    if (args.existing) {
      return new ConfigMapPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
      })
    }

    return new CreatedConfigMap(name, args, opts)
  }

  /**
   * Creates a new config map or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the config map name. Will not be used when existing config map is retrieved.
   * @param args The arguments to create or get the config map with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetConfigMapArgs,
    opts?: ComponentResourceOptions,
  ): Promise<ConfigMap> {
    if (args.existing) {
      return await ConfigMap.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedConfigMap(name, args, opts)
  }

  /**
   * Patches an existing config map.
   *
   * Will throw an error if the config map does not exist.
   *
   * @param name The name of the resource. May not be the same as the config map name.
   * @param args The arguments to patch the config map with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: ConfigMapArgs, opts?: ComponentResourceOptions): ConfigMap {
    return new ConfigMapPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes config map.
   */
  static wrap(
    name: string,
    args: WrappedConfigMapArgs,
    opts?: ComponentResourceOptions,
  ): ConfigMap {
    return new WrappedConfigMap(name, args, opts)
  }

  /**
   * Gets an existing config map.
   *
   * Will throw an error if the config map does not exist.
   */
  static get(
    name: string,
    args: ExternalConfigMapArgs,
    opts?: ComponentResourceOptions,
  ): ConfigMap {
    return new ExternalConfigMap(name, args, opts)
  }

  private static readonly configMapCache = new Map<string, ConfigMap>()

  /**
   * Gets an existing config map for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the config map for.
   * @param cluster The cluster where the config map is located.
   */
  static for(entity: k8s.NamespacedResource, cluster: Input<k8s.Cluster>): ConfigMap {
    return getOrCreate(
      ConfigMap.configMapCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return ConfigMap.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing config map for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the config map for.
   * @param cluster The cluster where the config map is located.
   */
  static async forAsync(
    entity: Input<k8s.NamespacedResource>,
    cluster: Input<k8s.Cluster>,
  ): Promise<ConfigMap> {
    const resolvedEntity = await toPromise(entity)
    return ConfigMap.for(resolvedEntity, cluster)
  }
}

class CreatedConfigMap extends ConfigMap {
  constructor(name: string, args: ConfigMapArgs, opts?: ComponentResourceOptions) {
    const configMap = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.ConfigMap(
        name,
        {
          metadata: mapMetadata(args, name),
          data: args.data,
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:ConfigMap",
      name,
      args,
      opts,
      configMap.metadata,
      output(args.namespace),
      configMap.data,
    )
  }
}

class ConfigMapPatch extends ConfigMap {
  constructor(name: string, args: ConfigMapArgs, opts?: ComponentResourceOptions) {
    const configMap = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.ConfigMapPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          data: args.data,
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:ConfigMapPatch",
      name,
      args,
      opts,
      configMap.metadata,
      output(args.namespace),
      configMap.data,
    )
  }
}

export type WrappedConfigMapArgs = {
  /**
   * The underlying Kubernetes config map to wrap.
   */
  configMap: Input<core.v1.ConfigMap>

  /**
   * The namespace where the config map is located.
   */
  namespace: Input<Namespace>
}

class WrappedConfigMap extends ConfigMap {
  constructor(name: string, args: WrappedConfigMapArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedConfigMap",
      name,
      args,
      opts,
      output(args.configMap).metadata,
      output(args.namespace),
      output(args.configMap).data,
    )
  }
}

export type ExternalConfigMapArgs = {
  /**
   * The name of the config map to get.
   */
  name: Input<string>

  /**
   * The namespace where the config map is located.
   */
  namespace: Input<Namespace>
}

class ExternalConfigMap extends ConfigMap {
  constructor(name: string, args: ExternalConfigMapArgs, opts?: ComponentResourceOptions) {
    const configMap = output(args.namespace).cluster.apply(cluster => {
      return core.v1.ConfigMap.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalConfigMap",
      name,
      args,
      opts,
      configMap.metadata,
      output(args.namespace),
      configMap.data,
    )
  }
}
