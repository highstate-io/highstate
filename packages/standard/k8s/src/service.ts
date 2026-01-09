import { filterEndpoints, l4EndpointToString, parseL3Endpoint } from "@highstate/common"
import { check, getOrCreate } from "@highstate/contract"
import { k8s, type network } from "@highstate/library"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  normalize,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { core, type types } from "@pulumi/kubernetes"
import { deepmerge } from "deepmerge-ts"
import { omit, uniqueBy } from "remeda"
import { Namespace } from "./namespace"
import {
  commonExtraArgs,
  getProvider,
  mapMetadata,
  NamespacedResource,
  type ScopedResourceArgs,
} from "./shared"

export type ServiceArgs = ScopedResourceArgs & {
  /**
   * The port to expose the service on.
   */
  port?: Input<types.input.core.v1.ServicePort>

  /**
   * Whether the service should be exposed by `NodePort` or `LoadBalancer`.
   *
   * The type of the service will be determined automatically based on the cluster.
   */
  external?: Input<boolean>
} & types.input.core.v1.ServiceSpec

export type CreateOrGetServiceArgs = ServiceArgs & {
  /**
   * The service entity to patch/retrieve.
   */
  existing: Input<k8s.Service> | undefined
}

const serviceExtraArgs = [...commonExtraArgs, "port", "ports", "external"] as const

/**
 * Checks if the endpoint is from the given cluster.
 *
 * @param endpoint The endpoint to check.
 * @param cluster The cluster to check against.
 * @returns True if the endpoint is from the cluster, false otherwise.
 */
export function isEndpointFromCluster(
  endpoint: network.L3Endpoint,
  cluster: k8s.Cluster,
): endpoint is k8s.ServiceEndpoint {
  return (
    check(k8s.serviceEndpointSchema, endpoint) &&
    endpoint.metadata["k8s.service"].clusterId === cluster.id
  )
}

/**
 * Represents a Kubernetes Service resource with endpoints and metadata.
 */
export abstract class Service extends NamespacedResource {
  static apiVersion = "v1"
  static kind = "Service"

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    /**
     * The spec of the underlying Kubernetes service.
     */
    readonly spec: Output<types.output.core.v1.ServiceSpec>,

    /**
     * The status of the underlying Kubernetes service.
     */
    readonly status: Output<types.output.core.v1.ServiceStatus>,
  ) {
    super(type, name, args, opts, metadata, namespace)
  }

  /**
   * The Highstate service entity.
   */
  get entity(): Output<k8s.Service> {
    return output({
      ...this.entityBase,
      endpoints: this.endpoints,
    })
  }

  /**
   * Creates a new service.
   */
  static create(name: string, args: ServiceArgs, opts?: ComponentResourceOptions): Service {
    return new CreatedService(name, args, opts)
  }

  /**
   * Creates a new service or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the service name.
   * @param args The arguments to create or patch the service with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetServiceArgs,
    opts?: ComponentResourceOptions,
  ): Service {
    if (args.existing) {
      return new ServicePatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedService(name, args, opts)
  }

  /**
   * Creates a new service or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the service name. Will not be used when existing service is retrieved.
   * @param args The arguments to create or get the service with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetServiceArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Service> {
    if (args.existing) {
      return await Service.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedService(name, args, opts)
  }

  /**
   * Patches an existing service.
   *
   * Will throw an error if the service does not exist.
   *
   * @param name The name of the resource. May not be the same as the service name.
   * @param args The arguments to patch the service with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: ServiceArgs, opts?: ComponentResourceOptions): Service {
    return new ServicePatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes service.
   */
  static wrap(name: string, args: WrappedServiceArgs, opts?: ComponentResourceOptions): Service {
    return new WrappedService(name, args, opts)
  }

  /**
   * Gets an existing service.
   *
   * Will throw an error if the service does not exist.
   */
  static get(name: string, args: ExternalServiceArgs, opts?: ComponentResourceOptions): Service {
    return new ExternalService(name, args, opts)
  }

  private static readonly serviceCache = new Map<string, Service>()

  /**
   * Gets an existing service for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the service for.
   * @param cluster The cluster where the service is located.
   */
  static for(entity: k8s.Service, cluster: Input<k8s.Cluster>): Service {
    return getOrCreate(
      Service.serviceCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Service.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResourceAsync(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing service for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the service for.
   * @param cluster The cluster where the service is located.
   */
  static async forAsync(entity: Input<k8s.Service>, cluster: Input<k8s.Cluster>): Promise<Service> {
    const resolvedEntity = await toPromise(entity)

    return Service.for(resolvedEntity, output(cluster))
  }

  /**
   * Returns the endpoints of the service including both internal and external endpoints.
   */
  get endpoints(): Output<k8s.ServiceEndpoint[]> {
    return output({
      cluster: this.cluster,
      metadata: this.metadata,
      spec: this.spec,
      status: this.status,
    }).apply(({ cluster, metadata, spec, status }) => {
      const endpointMetadata: k8s.EndpointServiceMetadata = {
        "k8s.service": {
          clusterId: cluster.id,
          clusterName: cluster.name,
          name: metadata.name,
          namespace: metadata.namespace,
          selector: spec.selector,
          targetPort: spec.ports[0].targetPort ?? spec.ports[0].port,
        },
      }

      const clusterIpEndpoints = spec.clusterIPs?.map(ip => ({
        ...parseL3Endpoint(ip),
        tags: ["k8s.internal"],
        port: spec.ports[0].port,
        protocol: spec.ports[0].protocol?.toLowerCase() as network.L4Protocol,
        metadata: endpointMetadata,
      }))

      if (clusterIpEndpoints.length > 0) {
        clusterIpEndpoints.unshift({
          type: "hostname",
          tags: ["k8s.internal"],
          hostname: `${metadata.name}.${metadata.namespace}.svc.cluster.local`,
          port: spec.ports[0].port,
          protocol: spec.ports[0].protocol?.toLowerCase() as network.L4Protocol,
          metadata: endpointMetadata,
        })
      }

      const nodePortEndpoints =
        spec.type === "NodePort"
          ? cluster.endpoints.map(endpoint => ({
              ...(endpoint as network.L3Endpoint),
              tags: ["k8s.external"],
              port: spec.ports[0].nodePort,
              protocol: spec.ports[0].protocol?.toLowerCase() as network.L4Protocol,
              metadata: endpointMetadata,
            }))
          : []

      const loadBalancerEndpoints =
        spec.type === "LoadBalancer"
          ? status.loadBalancer?.ingress?.map(endpoint => ({
              ...parseL3Endpoint(endpoint.ip ?? endpoint.hostname),
              tags: ["k8s.external"],
              port: spec.ports[0].port,
              protocol: spec.ports[0].protocol?.toLowerCase() as network.L4Protocol,
              metadata: endpointMetadata,
            }))
          : []

      return uniqueBy(
        [
          ...(clusterIpEndpoints ?? []),
          ...(loadBalancerEndpoints ?? []),
          ...(nodePortEndpoints ?? []),
        ],
        l4EndpointToString,
      )
    })
  }
}

/**
 * Creates the service spec configuration based on arguments and cluster settings.
 *
 * @param args The service arguments containing port and external configuration.
 * @param cluster The cluster where the service will be created.
 * @returns The service spec configuration.
 */
function createServiceSpec(args: ServiceArgs, cluster: k8s.Cluster) {
  return output(args).apply(args => {
    return deepmerge(
      {
        ports: normalize(args.port, args.ports),

        externalIPs: args.external
          ? args.externalIPs
            ? args.externalIPs
            : cluster.externalIps
          : normalize(undefined, args.externalIPs),

        type: getServiceType(args, cluster),
      },
      omit(args, serviceExtraArgs),
    )
  })
}

class CreatedService extends Service {
  constructor(name: string, args: ServiceArgs, opts?: ComponentResourceOptions) {
    const service = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.Service(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: createServiceSpec(args, cluster),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Service",
      name,
      args,
      opts,
      service.metadata,
      output(args.namespace),
      service.spec,
      service.status,
    )
  }
}

class ServicePatch extends Service {
  constructor(name: string, args: ServiceArgs, opts?: ComponentResourceOptions) {
    const service = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.ServicePatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: createServiceSpec(args, cluster),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ServicePatch",
      name,
      args,
      opts,
      service.metadata,
      output(args.namespace),
      service.spec,
      service.status,
    )
  }
}

export type WrappedServiceArgs = {
  /**
   * The underlying Kubernetes service to wrap.
   */
  service: Input<core.v1.Service>

  /**
   * The namespace where the service is located.
   */
  namespace: Input<Namespace>
}

class WrappedService extends Service {
  constructor(name: string, args: WrappedServiceArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedService",
      name,
      args,
      opts,
      output(args.service).metadata,
      output(args.namespace),
      output(args.service).spec,
      output(args.service).status,
    )
  }
}

export type ExternalServiceArgs = {
  /**
   * The name of the service to get.
   */
  name: Input<string>

  /**
   * The namespace of the service to get.
   */
  namespace: Input<Namespace>
}

class ExternalService extends Service {
  constructor(name: string, args: ExternalServiceArgs, opts?: ComponentResourceOptions) {
    const service = output(args.namespace).cluster.apply(cluster => {
      return core.v1.Service.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalService",
      name,
      args,
      opts,
      service.metadata,
      output(args.namespace),
      service.spec,
      service.status,
    )
  }
}

/**
 * Maps a container port to a service port.
 *
 * @param port The container port to map.
 * @returns The corresponding service port configuration.
 */
export function mapContainerPortToServicePort(
  port: types.input.core.v1.ContainerPort,
): types.input.core.v1.ServicePort {
  return {
    name: port.name,
    port: port.containerPort,
    targetPort: port.containerPort,
    protocol: port.protocol,
  }
}

/**
 * Maps a service to a label selector.
 *
 * @param service The service to extract the label selector from.
 * @returns The label selector based on the service's selector.
 */
export function mapServiceToLabelSelector(
  service: core.v1.Service,
): types.input.meta.v1.LabelSelector {
  return {
    matchLabels: service.spec.selector,
  }
}

/**
 * Determines the appropriate service type based on the service arguments and cluster configuration.
 *
 * @param service The service configuration containing type and external properties.
 * @param cluster The cluster where the service will be created.
 * @returns The service type to use.
 */
export function getServiceType(
  service: Pick<ServiceArgs, "type" | "external"> | undefined,
  cluster: k8s.Cluster,
): Input<string> {
  if (service?.type) {
    return service.type
  }

  if (!service?.external) {
    return "ClusterIP"
  }

  return cluster.quirks?.externalServiceType === "LoadBalancer" ? "LoadBalancer" : "NodePort"
}

/**
 * Converts a network L4 endpoint to a Kubernetes service port.
 *
 * @param endpoint The L4 endpoint to convert.
 * @returns The corresponding Kubernetes service port configuration.
 */
export function l4EndpointToServicePort(
  endpoint: network.L4Endpoint,
): types.input.core.v1.ServicePort {
  return {
    port: endpoint.port,
    protocol: endpoint.protocol.toUpperCase(),
  }
}
