import type { k8s, network } from "@highstate/library"
import type { types } from "@pulumi/kubernetes"
import type { SetRequired } from "type-fest"
import { parseEndpoint } from "@highstate/common"
import { getOrCreate } from "@highstate/contract"
import { gateway, type types as gwTypes } from "@highstate/gateway-api"
import {
  type ComponentResourceOptions,
  type Input,
  type InputArray,
  type Inputs,
  interpolate,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { omit } from "remeda"
import { Namespace } from "../namespace"
import {
  commonExtraArgs,
  getProvider,
  mapMetadata,
  NamespacedResource,
  type ScopedResourceArgs,
} from "../shared"

export type GatewayArgs = ScopedResourceArgs & {
  /**
   * The FQDN to configure the listeners for.
   */
  fqdn?: Input<string>

  /**
   * The FQDNs to configure the listeners for.
   */
  fqdns?: InputArray<string>
} & gwTypes.input.gateway.v1.GatewaySpec

export type CreateOrGetGatewayArgs = GatewayArgs & {
  /**
   * The gateway entity to patch/retrieve.
   */
  existing: Input<k8s.Gateway> | undefined
}

const gatewayExtraArgs = [...commonExtraArgs, "fqdn", "fqdns"] as const

/**
 * Represents a Kubernetes Gateway resource.
 */
export abstract class Gateway extends NamespacedResource {
  static readonly apiVersion = "gateway.networking.k8s.io/v1"
  static readonly kind = "Gateway"

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    /**
     * The namespace where the gateway is located.
     */
    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    /**
     * The spec of the underlying Gateway resource.
     */
    readonly spec: Output<gwTypes.output.gateway.v1.GatewaySpec>,

    /**
     * The status of the underlying Gateway resource.
     */
    readonly status: Output<gwTypes.output.gateway.v1.GatewayStatus>,
  ) {
    super(type, name, args, opts, metadata, namespace)
  }

  /**
   * The Highstate gateway entity.
   */
  get entity(): Output<k8s.Gateway> {
    return output(this.entityBase)
  }

  /**
   * Returns the endpoints L3 endpoints on which the gateway is exposed.
   */
  get endpoints(): Output<network.L3Endpoint[]> {
    return this.status.addresses.apply(addresses => {
      if (!addresses) {
        return []
      }

      return addresses.map(address => parseEndpoint(address.value))
    })
  }

  /**
   * Creates a new gateway.
   */
  static create(name: string, args: GatewayArgs, opts?: ComponentResourceOptions): Gateway {
    return new CreatedGateway(name, args, opts)
  }

  /**
   * Creates a new gateway or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the gateway name.
   * @param args The arguments to create or patch the gateway with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetGatewayArgs,
    opts?: ComponentResourceOptions,
  ): Gateway {
    if (args.existing) {
      return new GatewayPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedGateway(name, args, opts)
  }

  /**
   * Creates a new gateway or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the gateway name. Will not be used when existing gateway is retrieved.
   * @param args The arguments to create or get the gateway with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetGatewayArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Gateway> {
    if (args.existing) {
      return await Gateway.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedGateway(name, args, opts)
  }

  /**
   * Patches an existing gateway.
   *
   * Will throw an error if the gateway does not exist.
   *
   * @param name The name of the resource. May not be the same as the gateway name.
   * @param args The arguments to patch the gateway with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: GatewayArgs, opts?: ComponentResourceOptions): Gateway {
    return new GatewayPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes gateway.
   */
  static wrap(name: string, args: WrappedGatewayArgs, opts?: ComponentResourceOptions): Gateway {
    return new WrappedGateway(name, args, opts)
  }

  /**
   * Gets an existing gateway.
   *
   * Will throw an error if the gateway does not exist.
   */
  static get(name: string, args: ExternalGatewayArgs, opts?: ComponentResourceOptions): Gateway {
    return new ExternalGateway(name, args, opts)
  }

  private static readonly gatewayCache = new Map<string, Gateway>()

  /**
   * Gets an existing gateway for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{gatewayName}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the gateway for.
   * @param cluster The cluster where the gateway is located.
   */
  static for(entity: k8s.Gateway, cluster: Input<k8s.Cluster>): Gateway {
    return getOrCreate(
      Gateway.gatewayCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Gateway.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResourceAsync(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing gateway for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{gatewayName}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the gateway for.
   * @param cluster The cluster where the gateway is located.
   */
  static async forAsync(entity: Input<k8s.Gateway>, cluster: Input<k8s.Cluster>): Promise<Gateway> {
    const resolvedEntity = await toPromise(entity)

    return Gateway.for(resolvedEntity, output(cluster))
  }

  /**
   * Creates a gateway with the provided name/namespace/cluster only once.
   *
   * It automatically names the resource with the following format: `{name}.{namespace}.{clusterName}.{clusterId}`.
   *
   * On subsequent calls the gateway is patched with the union of existing and requested listeners.
   * Only the listeners field is modified to avoid altering other spec fields.
   *
   * @param name The name of the gateway to create.
   * @param args The arguments to create the gateway with.
   * @param opts Optional resource options.
   */
  static async createOnce(
    args: SetRequired<GatewayArgs, "name">,
    opts?: ComponentResourceOptions,
  ): Promise<Gateway> {
    const { name, namespace, cluster } = await toPromise({
      name: args.name,
      namespace: output(args.namespace).metadata.name,
      cluster: output(args.namespace).cluster,
    })

    const fullName = `${name}.${namespace}.${cluster.name}.${cluster.id}`

    const existing = Gateway.gatewayCache.get(fullName)
    if (existing) {
      Gateway.patch(
        fullName,
        {
          name,
          namespace: args.namespace,
          listeners: args.listeners,
        },
        opts,
      )

      return existing
    }

    const created = Gateway.create(
      fullName,
      {
        ...args,
        name,
        namespace: args.namespace,
      },
      opts,
    )

    Gateway.gatewayCache.set(fullName, created)
    return created
  }
}

class CreatedGateway extends Gateway {
  constructor(name: string, args: GatewayArgs, opts?: ComponentResourceOptions) {
    const gatewayResource = output(args.namespace).cluster.apply(cluster => {
      return new gateway.v1.Gateway(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: omit(args, gatewayExtraArgs),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Gateway",
      name,
      args,
      opts,

      gatewayResource.metadata as Output<types.output.meta.v1.ObjectMeta>,
      output(args.namespace),
      gatewayResource.spec,
      gatewayResource.status,
    )
  }
}

class GatewayPatch extends Gateway {
  constructor(name: string, args: GatewayArgs, opts?: ComponentResourceOptions) {
    const gatewayResource = output(args.namespace).cluster.apply(cluster => {
      return new gateway.v1.GatewayPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: omit(args, gatewayExtraArgs),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:GatewayPatch",
      name,
      args,
      opts,

      gatewayResource.metadata as Output<types.output.meta.v1.ObjectMeta>,
      output(args.namespace),
      gatewayResource.spec,
      gatewayResource.status,
    )
  }
}

export type WrappedGatewayArgs = {
  /**
   * The underlying Kubernetes gateway to wrap.
   */
  gateway: Input<gateway.v1.Gateway>

  /**
   * The namespace where the gateway is located.
   */
  namespace: Input<Namespace>
}

class WrappedGateway extends Gateway {
  constructor(name: string, args: WrappedGatewayArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedGateway",
      name,
      args,
      opts,

      output(args.gateway).metadata as Output<types.output.meta.v1.ObjectMeta>,
      output(args.namespace),
      output(args.gateway).spec,
      output(args.gateway).status,
    )
  }
}

export type ExternalGatewayArgs = {
  /**
   * The name of the gateway to get.
   */
  name: Input<string>

  /**
   * The namespace of the gateway to get.
   */
  namespace: Input<Namespace>
}

class ExternalGateway extends Gateway {
  constructor(name: string, args: ExternalGatewayArgs, opts?: ComponentResourceOptions) {
    const gatewayResource = output(args.namespace).cluster.apply(cluster => {
      return gateway.v1.Gateway.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalGateway",
      name,
      args,
      opts,

      gatewayResource.metadata as Output<types.output.meta.v1.ObjectMeta>,
      output(args.namespace),
      gatewayResource.spec,
      gatewayResource.status,
    )
  }
}
