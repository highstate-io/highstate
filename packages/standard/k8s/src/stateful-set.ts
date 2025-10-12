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

export type StatefulSetArgs = Omit<ExposableWorkloadArgs, "existing"> &
  Omit<Partial<types.input.apps.v1.StatefulSetSpec>, "template"> & {
    template?: {
      metadata?: types.input.meta.v1.ObjectMeta
      spec?: Partial<types.input.core.v1.PodSpec>
    }
  }

export type CreateOrGetStatefulSetArgs = StatefulSetArgs & {
  /**
   * The entity to use to determine the stateful set to patch.
   */
  existing: Input<k8s.StatefulSet> | undefined
}

export abstract class StatefulSet extends ExposableWorkload {
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
     * The spec of the underlying Kubernetes stateful set.
     */
    readonly spec: Output<types.output.apps.v1.StatefulSetSpec>,

    /**
     * The status of the underlying Kubernetes stateful set.
     */
    readonly status: Output<types.output.apps.v1.StatefulSetStatus>,
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

  /**
   * The Highstate stateful set entity.
   */
  get entity(): Output<k8s.StatefulSet> {
    return output({
      type: "stateful-set",
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      metadata: this.metadata,
      service: this.service.entity,
    })
  }

  /**
   * Creates a new stateful set.
   */
  static create(name: string, args: StatefulSetArgs, opts?: ComponentResourceOptions): StatefulSet {
    return new CreatedStatefulSet(name, args, opts)
  }

  /**
   * Creates a new stateful set or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the stateful set name.
   * @param args The arguments to create or patch the stateful set with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetStatefulSetArgs,
    opts?: ComponentResourceOptions,
  ): StatefulSet {
    if (args.existing) {
      return new StatefulSetPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedStatefulSet(name, args, opts)
  }

  /**
   * Creates a new stateful set or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the stateful set name. Will not be used when existing stateful set is retrieved.
   * @param args The arguments to create or get the stateful set with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetStatefulSetArgs,
    opts?: ComponentResourceOptions,
  ): Promise<StatefulSet> {
    if (args.existing) {
      return await StatefulSet.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedStatefulSet(name, args, opts)
  }

  /**
   * Patches an existing stateful set.
   *
   * Will throw an error if the stateful set does not exist.
   *
   * @param name The name of the resource. May not be the same as the stateful set name.
   * @param args The arguments to patch the stateful set with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: StatefulSetArgs, opts?: ComponentResourceOptions): StatefulSet {
    return new StatefulSetPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes stateful set.
   */
  static wrap(
    name: string,
    args: WrappedStatefulSetArgs,
    opts?: ComponentResourceOptions,
  ): StatefulSet {
    return new WrappedStatefulSet(name, args, opts)
  }

  /**
   * Gets an existing stateful set.
   *
   * Will throw an error if the stateful set does not exist.
   */
  static get(
    name: string,
    args: ExternalStatefulSetArgs,
    opts?: ComponentResourceOptions,
  ): StatefulSet {
    return new ExternalStatefulSet(name, args, opts)
  }

  private static readonly statefulSetCache = new Map<string, StatefulSet>()

  /**
   * Gets an existing stateful set for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the stateful set for.
   * @param cluster The cluster where the stateful set is located.
   */
  static for(entity: k8s.StatefulSet, cluster: Input<k8s.Cluster>): StatefulSet {
    return getOrCreate(
      StatefulSet.statefulSetCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return StatefulSet.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing stateful set for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the stateful set for.
   * @param cluster The cluster where the stateful set is located.
   */
  static async forAsync(
    entity: Input<k8s.StatefulSet>,
    cluster: Input<k8s.Cluster>,
  ): Promise<StatefulSet> {
    const resolvedEntity = await toPromise(entity)
    return StatefulSet.for(resolvedEntity, cluster)
  }

  protected getTerminalMeta(): Output<UnitTerminal["meta"]> {
    return output({
      title: "StatefulSet",
      globalTitle: interpolate`StatefulSet | ${this.metadata.name}`,
      description: "The shell inside the stateful set.",
      icon: "devicon:kubernetes",
    })
  }

  protected get resourceType(): string {
    return "statefulset"
  }
}

class CreatedStatefulSet extends StatefulSet {
  constructor(name: string, args: StatefulSetArgs, opts?: ComponentResourceOptions) {
    const { labels, podTemplate, networkPolicy, containers, service, routes } =
      getExposableWorkloadComponents(
        name,
        {
          ...args,

          // force create a service since it is required for stateful sets
          service: output(args.service).apply(service => ({ ...service })),
        },
        () => this,
        opts,
      )

    const statefulSet = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.StatefulSet(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate, labels, service }).apply(
            ({ args, podTemplate, labels, service }) => {
              return deepmerge(
                {
                  serviceName: service?.metadata.name,
                  template: podTemplate,
                  selector: { matchLabels: labels },
                },
                omit(args, exposableWorkloadExtraArgs),
              ) as types.input.apps.v1.StatefulSetSpec
            },
          ),
        },
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),
        },
      )
    })

    super(
      "highstate:k8s:StatefulSet",
      name,
      args,
      opts,

      statefulSet.apiVersion,
      statefulSet.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      statefulSet.metadata,
      networkPolicy,

      service,
      routes,

      statefulSet.spec,
      statefulSet.status,
    )
  }
}

class StatefulSetPatch extends StatefulSet {
  constructor(name: string, args: StatefulSetArgs, opts?: ComponentResourceOptions) {
    const { labels, podTemplate, networkPolicy, containers, service, routes } =
      getExposableWorkloadComponents(name, args, () => this, opts)

    const statefulSet = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.StatefulSetPatch(
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
            ) as types.input.apps.v1.StatefulSetSpec
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
      "highstate:k8s:StatefulSetPatch",
      name,
      args,
      opts,

      statefulSet.apiVersion,
      statefulSet.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      statefulSet.metadata,
      networkPolicy,

      service,
      routes,

      statefulSet.spec,
      statefulSet.status,
    )
  }
}

export type WrappedStatefulSetArgs = {
  /**
   * The underlying Kubernetes stateful set to wrap.
   */
  statefulSet: Input<apps.v1.StatefulSet>

  // TODO: remove
  service?: Input<Service>

  /**
   * The namespace where the stateful set is located.
   */
  namespace: Input<Namespace>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>
}

class WrappedStatefulSet extends StatefulSet {
  constructor(name: string, args: WrappedStatefulSetArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedStatefulSet",
      name,
      args,
      opts,

      output(args.statefulSet).apiVersion,
      output(args.statefulSet).kind,
      output(args.terminal ?? {}),
      output([]),
      output(args.namespace),
      output(args.statefulSet).metadata,

      output(undefined),
      output(args.service),
      output([]),

      output(args.statefulSet).spec,
      output(args.statefulSet).status,
    )
  }
}

export type ExternalStatefulSetArgs = {
  /**
   * The name of the stateful set to get.
   */
  name: Input<string>

  /**
   * The namespace where the stateful set is located.
   */
  namespace: Input<Namespace>
}

class ExternalStatefulSet extends StatefulSet {
  constructor(name: string, args: ExternalStatefulSetArgs, opts?: ComponentResourceOptions) {
    const statefulSet = output(args.namespace).cluster.apply(cluster => {
      return apps.v1.StatefulSet.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalStatefulSet",
      name,
      args,
      opts,

      statefulSet.apiVersion,
      statefulSet.kind,
      output({}),
      output([]),
      output(args.namespace),
      statefulSet.metadata,

      output(undefined),
      output(undefined),
      output([]),

      statefulSet.spec,
      statefulSet.status,
    )
  }
}
