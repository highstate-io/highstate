import type { AccessPointRoute } from "@highstate/common"
import type { Container } from "./container"
import type { NetworkPolicy } from "./network-policy"
import type { Service } from "./service"
import { getOrCreate, type UnitTerminal } from "@highstate/contract"
import { k8s } from "@highstate/library"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  makeEntityOutput,
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
  filterPatchOwnedContainersInTemplate,
  getWorkloadServiceComponents,
  Workload,
  type WorkloadServiceArgs,
  type WorkloadTerminalArgs,
  workloadServiceExtraArgs,
} from "./workload"

export type DaemonSetArgs = Omit<WorkloadServiceArgs, "existing"> &
  Omit<Partial<types.input.apps.v1.DaemonSetSpec>, "template"> & {
    template?: {
      metadata?: types.input.meta.v1.ObjectMeta
      spec?: Partial<types.input.core.v1.PodSpec>
    }
  }

export type CreateOrGetDaemonSetArgs = DaemonSetArgs & {
  /**
   * The entity to use to determine the daemon set to patch.
   */
  existing: Input<k8s.DaemonSet> | undefined
}

export abstract class DaemonSet extends Workload {
  static readonly apiVersion = "apps/v1"
  static readonly kind = "DaemonSet"

  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    terminalArgs: Output<Unwrap<WorkloadTerminalArgs>>,
    containers: Output<Container[]>,
    networkPolicy: Output<NetworkPolicy | undefined>,

    service: Output<Service | undefined>,
    routes: Output<AccessPointRoute[]>,

    /**
     * The spec of the underlying Kubernetes daemon set.
     */
    readonly spec: Output<types.output.apps.v1.DaemonSetSpec>,

    /**
     * The status of the underlying Kubernetes daemon set.
     */
    readonly status: Output<types.output.apps.v1.DaemonSetStatus>,
  ) {
    super(
      type,
      name,
      args,
      opts,
      metadata,
      namespace,
      terminalArgs,
      containers,
      spec.template,
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
      title: "DaemonSet",
      globalTitle: interpolate`DaemonSet | ${this.metadata.name}`,
      description: "The shell inside the daemon set.",
      icon: "devicon:kubernetes",
    })
  }

  /**
   * The Highstate daemon set entity.
   */
  get entity(): Output<k8s.DaemonSet> {
    const service = this._service.apply(service => service?.entity)

    return makeEntityOutput({
      entity: k8s.daemonSetEntity,
      identity: this.metadata.uid,
      meta: {
        title: this.metadata.name,
      },
      value: {
        ...this.entityBase,
        service,
        spec: this.spec,
      },
    })
  }

  /**
   * Creates a new daemon set.
   */
  static create(name: string, args: DaemonSetArgs, opts?: ComponentResourceOptions): DaemonSet {
    return new CreatedDaemonSet(name, args, opts)
  }

  /**
   * Creates a new daemon set or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the daemon set name.
   * @param args The arguments to create or patch the daemon set with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetDaemonSetArgs,
    opts?: ComponentResourceOptions,
  ): DaemonSet {
    if (args.existing) {
      return new DaemonSetPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedDaemonSet(name, args, opts)
  }

  /**
   * Creates a new daemon set or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the daemon set name. Will not be used when existing daemon set is retrieved.
   * @param args The arguments to create or get the daemon set with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetDaemonSetArgs,
    opts?: ComponentResourceOptions,
  ): Promise<DaemonSet> {
    if (args.existing) {
      return await DaemonSet.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedDaemonSet(name, args, opts)
  }

  /**
   * Patches an existing daemon set.
   *
   * Will throw an error if the daemon set does not exist.
   *
   * @param name The name of the resource. May not be the same as the daemon set name.
   * @param args The arguments to patch the daemon set with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: DaemonSetArgs, opts?: ComponentResourceOptions): DaemonSet {
    return new DaemonSetPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes daemon set.
   */
  static wrap(
    name: string,
    args: WrappedDaemonSetArgs,
    opts?: ComponentResourceOptions,
  ): DaemonSet {
    return new WrappedDaemonSet(name, args, opts)
  }

  /**
   * Gets an existing daemon set.
   *
   * Will throw an error if the daemon set does not exist.
   */
  static get(
    name: string,
    args: ExternalDaemonSetArgs,
    opts?: ComponentResourceOptions,
  ): DaemonSet {
    return new ExternalDaemonSet(name, args, opts)
  }

  private static readonly daemonSetCache = new Map<string, DaemonSet>()

  /**
   * Gets an existing daemon set for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the daemon set for.
   * @param cluster The cluster where the daemon set is located.
   */
  static for(entity: k8s.DaemonSet, cluster: Input<k8s.Cluster>): DaemonSet {
    return getOrCreate(
      DaemonSet.daemonSetCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return DaemonSet.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing daemon set for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the daemon set for.
   * @param cluster The cluster where the daemon set is located.
   */
  static async forAsync(
    entity: Input<k8s.DaemonSet>,
    cluster: Input<k8s.Cluster>,
  ): Promise<DaemonSet> {
    const resolvedEntity = await toPromise(entity)
    return DaemonSet.for(resolvedEntity, cluster)
  }
}

class CreatedDaemonSet extends DaemonSet {
  constructor(name: string, args: DaemonSetArgs, opts?: ComponentResourceOptions) {
    const { labels, podTemplate, networkPolicy, containers, service, routes } =
      getWorkloadServiceComponents(name, args, () => this, opts)

    const daemonSet = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.DaemonSet(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate, labels }).apply(({ args, podTemplate, labels }) => {
            return deepmerge(
              {
                template: podTemplate,
                selector: { matchLabels: labels },
              },
              omit(args, workloadServiceExtraArgs),
            ) as types.input.apps.v1.DaemonSetSpec
          }),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:DaemonSet",
      name,
      args,
      opts,
      daemonSet.metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      containers,
      networkPolicy,
      service,
      routes,
      daemonSet.spec,
      daemonSet.status,
    )
  }
}

class DaemonSetPatch extends DaemonSet {
  constructor(name: string, args: DaemonSetArgs, opts?: ComponentResourceOptions) {
    const { podTemplate, networkPolicy, containers, service, routes } =
      getWorkloadServiceComponents(name, args, () => this, opts, true)

    const daemonSet = output(args.namespace).cluster.apply(cluster => {
      return new apps.v1.DaemonSetPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate }).apply(({ args, podTemplate }) => {
            const spec = deepmerge(
              { template: podTemplate },
              omit(args, workloadServiceExtraArgs),
            ) as Unwrap<types.input.apps.v1.DaemonSetSpec>

            if (spec.template) {
              spec.template = filterPatchOwnedContainersInTemplate(spec.template, podTemplate)
            }

            return spec
          }),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    const filteredSpec = output({ spec: daemonSet.spec, podTemplate }).apply(
      ({ spec, podTemplate }) => {
        if (!spec.template) {
          return spec
        }

        return {
          ...spec,
          template: filterPatchOwnedContainersInTemplate(
            spec.template as Unwrap<types.input.core.v1.PodTemplateSpec>,
            podTemplate,
          ) as types.output.core.v1.PodTemplateSpec,
        }
      },
    ) as Output<types.output.apps.v1.DaemonSetSpec>

    super(
      "highstate:k8s:DaemonSetPatch",
      name,
      args,
      opts,
      daemonSet.metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      containers,
      networkPolicy,
      service,
      routes,
      filteredSpec,
      daemonSet.status,
    )
  }
}

export type WrappedDaemonSetArgs = {
  /**
   * The underlying Kubernetes daemon set to wrap.
   */
  daemonSet: Input<apps.v1.DaemonSet>

  /**
   * The namespace where the daemon set is located.
   */
  namespace: Input<Namespace>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>
}

class WrappedDaemonSet extends DaemonSet {
  constructor(name: string, args: WrappedDaemonSetArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedDaemonSet",
      name,
      args,
      opts,
      output(args.daemonSet).metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      output([]),
      output(undefined),
      output(undefined),
      output([]),
      output(args.daemonSet).spec,
      output(args.daemonSet).status,
    )
  }
}

export type ExternalDaemonSetArgs = {
  /**
   * The name of the daemon set to get.
   */
  name: Input<string>

  /**
   * The namespace where the daemon set is located.
   */
  namespace: Input<Namespace>
}

class ExternalDaemonSet extends DaemonSet {
  constructor(name: string, args: ExternalDaemonSetArgs, opts?: ComponentResourceOptions) {
    const daemonSet = output(args.namespace).cluster.apply(cluster => {
      return apps.v1.DaemonSet.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalDaemonSet",
      name,
      args,
      opts,
      daemonSet.metadata,
      output(args.namespace),
      output({}),
      output([]),
      output(undefined),
      output(undefined),
      output([]),
      daemonSet.spec,
      daemonSet.status,
    )
  }
}
