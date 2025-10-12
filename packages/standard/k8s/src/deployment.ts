import type { AccessPointRoute } from "@highstate/common"
import type { k8s } from "@highstate/library"
import type { Container } from "./container"
import type { NetworkPolicy } from "./network-policy"
import type { Service } from "./service"
import { getOrCreate, type UnitTerminal } from "@highstate/contract"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  type Output,
  output,
  toPromise,
  type Unwrap,
} from "@highstate/pulumi"
import { apps, type types } from "@pulumi/kubernetes"
import { deepmerge } from "deepmerge-ts"
import { omit } from "remeda"
import { Namespace } from "./namespace"
import { getProvider, mapMetadata } from "./shared"
import {
  ExposableWorkload,
  type ExposableWorkloadArgs,
  exposableWorkloadExtraArgs,
  getExposableWorkloadComponents,
  type WorkloadTerminalArgs,
} from "./workload"

export type DeploymentArgs = Omit<ExposableWorkloadArgs, "existing"> &
  Omit<Partial<types.input.apps.v1.DeploymentSpec>, "template"> & {
    template?: {
      metadata?: types.input.meta.v1.ObjectMeta
      spec?: Partial<types.input.core.v1.PodSpec>
    }
  }

export type CreateOrGetDeploymentArgs = DeploymentArgs & {
  /**
   * The entity to use to determine the deployment to patch.
   */
  existing: Input<k8s.Deployment> | undefined
}

export abstract class Deployment extends ExposableWorkload {
  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    apiVersion: Output<string>,
    kind: Output<string>,
    terminalArgs: Output<Unwrap<WorkloadTerminalArgs>>,
    containers: Output<Container[]>,
    namespace: Output<Namespace>,
    metadata: Output<types.output.meta.v1.ObjectMeta>,
    networkPolicy: Output<NetworkPolicy | undefined>,

    service: Output<Service | undefined>,
    routes: Output<AccessPointRoute[]>,

    /**
     * The spec of the underlying Kubernetes deployment.
     */
    readonly spec: Output<types.output.apps.v1.DeploymentSpec>,

    /**
     * The status of the underlying Kubernetes deployment.
     */
    readonly status: Output<types.output.apps.v1.DeploymentStatus>,
  ) {
    super(
      type,
      name,
      args,
      opts,
      apiVersion,
      kind,
      terminalArgs,
      containers,
      namespace,
      metadata,
      networkPolicy,
      service,
      routes,
    )
  }

  protected override get templateMetadata(): Output<types.output.meta.v1.ObjectMeta> {
    return this.spec.template.metadata
  }

  protected override getTerminalMeta(): Output<UnitTerminal["meta"]> {
    return output({
      title: "Deployment",
      globalTitle: interpolate`Deployment | ${this.metadata.name}`,
      description: "The shell inside the deployment.",
      icon: "devicon:kubernetes",
    })
  }

  /**
   * The Highstate deployment entity.
   */
  get entity(): Output<k8s.Deployment> {
    return output({
      type: "deployment",
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      metadata: this.metadata,
      service: this._service.apply(service => service?.entity),
    })
  }

  /**
   * Creates a new deployment.
   */
  static create(name: string, args: DeploymentArgs, opts?: ComponentResourceOptions): Deployment {
    return new CreatedDeployment(name, args, opts)
  }

  /**
   * Creates a new deployment or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the deployment name.
   * @param args The arguments to create or patch the deployment with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetDeploymentArgs,
    opts?: ComponentResourceOptions,
  ): Deployment {
    if (args.existing) {
      return new DeploymentPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedDeployment(name, args, opts)
  }

  /**
   * Creates a new deployment or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the deployment name. Will not be used when existing deployment is retrieved.
   * @param args The arguments to create or get the deployment with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetDeploymentArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Deployment> {
    if (args.existing) {
      return await Deployment.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedDeployment(name, args, opts)
  }

  /**
   * Patches an existing deployment.
   *
   * Will throw an error if the deployment does not exist.
   *
   * @param name The name of the resource. May not be the same as the deployment name.
   * @param args The arguments to patch the deployment with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: DeploymentArgs, opts?: ComponentResourceOptions): Deployment {
    return new DeploymentPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes deployment.
   */
  static wrap(
    name: string,
    args: WrappedDeploymentArgs,
    opts?: ComponentResourceOptions,
  ): Deployment {
    return new WrappedDeployment(name, args, opts)
  }

  /**
   * Gets an existing deployment.
   *
   * Will throw an error if the deployment does not exist.
   */
  static get(
    name: string,
    args: ExternalDeploymentArgs,
    opts?: ComponentResourceOptions,
  ): Deployment {
    return new ExternalDeployment(name, args, opts)
  }

  private static readonly deploymentCache = new Map<string, Deployment>()

  /**
   * Gets an existing deployment for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the deployment for.
   * @param cluster The cluster where the deployment is located.
   */
  static for(entity: k8s.Deployment, cluster: Input<k8s.Cluster>): Deployment {
    return getOrCreate(
      Deployment.deploymentCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Deployment.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing deployment for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the deployment for.
   * @param cluster The cluster where the deployment is located.
   */
  static async forAsync(
    entity: Input<k8s.Deployment>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Deployment> {
    const resolvedEntity = await toPromise(entity)
    return Deployment.for(resolvedEntity, cluster)
  }
}

class CreatedDeployment extends Deployment {
  constructor(name: string, args: DeploymentArgs, opts?: ComponentResourceOptions) {
    const { labels, podTemplate, networkPolicy, containers, service, routes } =
      getExposableWorkloadComponents(name, args, () => this, opts)

    const deployment = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.Deployment(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate, labels }).apply(({ args, podTemplate, labels }) => {
            return deepmerge(
              {
                template: podTemplate,
                selector: { matchLabels: labels },
              },
              omit(args, exposableWorkloadExtraArgs),
            ) as types.input.apps.v1.DeploymentSpec
          }),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Deployment",
      name,
      args,
      opts,

      deployment.apiVersion,
      deployment.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      deployment.metadata,
      networkPolicy,

      service,
      routes,

      deployment.spec,
      deployment.status,
    )
  }
}

class DeploymentPatch extends Deployment {
  constructor(name: string, args: DeploymentArgs, opts?: ComponentResourceOptions) {
    const { labels, podTemplate, networkPolicy, containers, service, routes } =
      getExposableWorkloadComponents(name, args, () => this, opts)

    const deployment = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.DeploymentPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate, labels }).apply(({ args, podTemplate, labels }) => {
            return deepmerge(
              {
                template: podTemplate,
                selector: { matchLabels: labels },
              },
              omit(args, exposableWorkloadExtraArgs),
            ) as types.input.apps.v1.DeploymentSpec
          }),
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:DeploymentPatch",
      name,
      args,
      opts,

      deployment.apiVersion,
      deployment.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      deployment.metadata,
      networkPolicy,

      service,
      routes,

      deployment.spec,
      deployment.status,
    )
  }
}

export type WrappedDeploymentArgs = {
  /**
   * The underlying Kubernetes deployment to wrap.
   */
  deployment: Input<apps.v1.Deployment>

  /**
   * The namespace where the deployment is located.
   */
  namespace: Input<Namespace>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>
}

class WrappedDeployment extends Deployment {
  constructor(name: string, args: WrappedDeploymentArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedDeployment",
      name,
      args,
      opts,

      output(args.deployment).apiVersion,
      output(args.deployment).kind,
      output(args.terminal ?? {}),
      output([]),
      output(args.namespace),
      output(args.deployment).metadata,

      output(undefined),
      output(undefined),
      output([]),

      output(args.deployment).spec,
      output(args.deployment).status,
    )
  }
}

export type ExternalDeploymentArgs = {
  /**
   * The name of the deployment to get.
   */
  name: Input<string>

  /**
   * The namespace where the deployment is located.
   */
  namespace: Input<Namespace>
}

class ExternalDeployment extends Deployment {
  constructor(name: string, args: ExternalDeploymentArgs, opts?: ComponentResourceOptions) {
    const deployment = output(args.namespace).cluster.apply(cluster => {
      return apps.v1.Deployment.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalDeployment",
      name,
      args,
      opts,

      deployment.apiVersion,
      deployment.kind,
      output({}),
      output([]),
      output(args.namespace),
      deployment.metadata,

      output(undefined),
      output(undefined),
      output([]),

      deployment.spec,
      deployment.status,
    )
  }
}
