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

export type SecretArgs = ScopedResourceArgs &
  Omit<types.input.core.v1.Secret, "kind" | "metadata" | "apiVersion">

export type CreateOrGetSecretArgs = SecretArgs & {
  /**
   * The secret entity to patch/retrieve.
   */
  existing: Input<k8s.NamespacedResource> | undefined
}

/**
 * Represents a Kubernetes Secret resource with metadata and data.
 */
export abstract class Secret extends NamespacedResource {
  static apiVersion = "v1"
  static kind = "Secret"

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    /**
     * The data of the underlying Kubernetes secret.
     */
    readonly data: Output<Record<string, string>>,

    /**
     * The stringData of the underlying Kubernetes secret.
     */
    readonly stringData: Output<Record<string, string>>,
  ) {
    super(type, name, args, opts, metadata, namespace)
  }

  /**
   * The Highstate secret entity.
   */
  get entity(): Output<k8s.Secret> {
    return output(this.entityBase)
  }

  /**
   * Gets the value of the secret field by the given key in `data`.
   *
   * Automatically decodes the base64 value.
   *
   * @param key The key of the secret.
   * @returns The value of the secret.
   */
  getValue(key: string): Output<string> {
    return this.data[key].apply(value => Buffer.from(value, "base64").toString())
  }

  /**
   * Creates a new secret.
   */
  static create(name: string, args: SecretArgs, opts?: ComponentResourceOptions): Secret {
    return new CreatedSecret(name, args, opts)
  }

  /**
   * Creates a new secret or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the secret name.
   * @param args The arguments to create or patch the secret with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetSecretArgs,
    opts?: ComponentResourceOptions,
  ): Secret {
    if (args.existing) {
      return new SecretPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
      })
    }

    return new CreatedSecret(name, args, opts)
  }

  /**
   * Creates a new secret or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the secret name. Will not be used when existing secret is retrieved.
   * @param args The arguments to create or get the secret with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetSecretArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Secret> {
    if (args.existing) {
      return await Secret.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedSecret(name, args, opts)
  }

  /**
   * Patches an existing secret.
   *
   * Will throw an error if the secret does not exist.
   *
   * @param name The name of the resource. May not be the same as the secret name.
   * @param args The arguments to patch the secret with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: SecretArgs, opts?: ComponentResourceOptions): Secret {
    return new SecretPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes secret.
   */
  static wrap(name: string, args: WrappedSecretArgs, opts?: ComponentResourceOptions): Secret {
    return new WrappedSecret(name, args, opts)
  }

  /**
   * Gets an existing secret.
   *
   * Will throw an error if the secret does not exist.
   */
  static get(name: string, args: ExternalSecretArgs, opts?: ComponentResourceOptions): Secret {
    return new ExternalSecret(name, args, opts)
  }

  private static readonly secretCache = new Map<string, Secret>()

  /**
   * Gets an existing secret for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the secret for.
   * @param cluster The cluster where the secret is located.
   */
  static for(entity: k8s.NamespacedResource, cluster: Input<k8s.Cluster>): Secret {
    return getOrCreate(
      Secret.secretCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Secret.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing secret for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the secret for.
   * @param cluster The cluster where the secret is located.
   */
  static async forAsync(
    entity: Input<k8s.NamespacedResource>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Secret> {
    const resolvedEntity = await toPromise(entity)
    return Secret.for(resolvedEntity, cluster)
  }
}

class CreatedSecret extends Secret {
  constructor(name: string, args: SecretArgs, opts?: ComponentResourceOptions) {
    const secret = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.Secret(
        name,
        {
          metadata: mapMetadata(args, name),
          data: args.data,
          stringData: args.stringData,
          type: args.type,
          immutable: args.immutable,
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:Secret",
      name,
      args,
      opts,
      secret.metadata,
      output(args.namespace),
      secret.data,
      secret.stringData,
    )
  }
}

class SecretPatch extends Secret {
  constructor(name: string, args: SecretArgs, opts?: ComponentResourceOptions) {
    const secret = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.SecretPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          data: args.data,
          stringData: args.stringData,
          type: args.type,
          immutable: args.immutable,
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:SecretPatch",
      name,
      args,
      opts,
      secret.metadata,
      output(args.namespace),
      secret.data,
      secret.stringData,
    )
  }
}

export type WrappedSecretArgs = {
  /**
   * The underlying Kubernetes secret to wrap.
   */
  secret: Input<core.v1.Secret>

  /**
   * The namespace where the secret is located.
   */
  namespace: Input<Namespace>
}

class WrappedSecret extends Secret {
  constructor(name: string, args: WrappedSecretArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedSecret",
      name,
      args,
      opts,
      output(args.secret).metadata,
      output(args.namespace),
      output(args.secret).data,
      output(args.secret).stringData,
    )
  }
}

export type ExternalSecretArgs = {
  /**
   * The name of the secret to get.
   */
  name: Input<string>

  /**
   * The namespace where the secret is located.
   */
  namespace: Input<Namespace>
}

class ExternalSecret extends Secret {
  constructor(name: string, args: ExternalSecretArgs, opts?: ComponentResourceOptions) {
    const secret = output(args.namespace).cluster.apply(async cluster => {
      const secret = core.v1.Secret.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )

      // TODO: investigate why this needed
      const namespace = await toPromise(output(args.namespace).metadata.name)
      const resolvedName = await toPromise(args.name)
      const metadata = await toPromise(secret.metadata)
      if (!metadata) {
        throw new Error(`Secret ${resolvedName} in namespace ${namespace} not found`)
      }

      return secret
    })

    super(
      "highstate:k8s:ExternalSecret",
      name,
      args,
      opts,
      secret.metadata,
      output(args.namespace),
      secret.data,
      secret.stringData,
    )
  }
}
