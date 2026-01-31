import type { UnitTerminal } from "@highstate/contract"
import type { k8s } from "@highstate/library"
import type { Container } from "./container"
import type { NetworkPolicy } from "./network-policy"
import { getOrCreate } from "@highstate/contract"
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
import { batch, type types } from "@pulumi/kubernetes"
import { deepmerge } from "deepmerge-ts"
import { omit } from "remeda"
import { Namespace } from "./namespace"
import { commonExtraArgs, getProvider, mapMetadata, type ScopedResourceArgs } from "./shared"
import {
  getWorkloadComponents,
  Workload,
  type WorkloadArgs,
  type WorkloadTerminalArgs,
} from "./workload"

export type CronJobArgs = ScopedResourceArgs &
  Omit<Partial<types.input.batch.v1.CronJobSpec>, "jobTemplate"> & {
    jobTemplate?: {
      metadata?: types.input.meta.v1.ObjectMeta
      spec?: Omit<types.input.batch.v1.JobSpec, "template"> & {
        template?: {
          metadata?: types.input.meta.v1.ObjectMeta
          spec?: Partial<types.input.core.v1.PodSpec>
        }
      }
    }
  } & WorkloadArgs

export type CreateOrGetCronJobArgs = CronJobArgs & {
  /**
   * The cron job entity to patch/retrieve.
   */
  existing: Input<k8s.NamespacedResource> | undefined
}

/**
 * Represents a Kubernetes CronJob resource with metadata and spec.
 */
export abstract class CronJob extends Workload {
  static apiVersion = "batch/v1"
  static kind = "CronJob"

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

    /**
     * The spec of the underlying Kubernetes cron job.
     */
    readonly spec: Output<types.output.batch.v1.CronJobSpec>,

    /**
     * The status of the underlying Kubernetes cron job.
     */
    readonly status: Output<types.output.batch.v1.CronJobStatus>,
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
      spec.jobTemplate.spec.template,
      networkPolicy,
    )
  }

  protected override get templateMetadata(): Output<types.output.meta.v1.ObjectMeta> {
    return this.spec.jobTemplate.spec.template.metadata
  }

  /**
   * The Highstate cron job entity.
   */
  get entity(): Output<k8s.CronJob> {
    return output(this.entityBase)
  }

  protected getTerminalMeta(): Output<UnitTerminal["meta"]> {
    return output({
      title: "CronJob",
      globalTitle: interpolate`CronJob | ${this.metadata.name}`,
      description: "The shell inside the cron job.",
      icon: "devicon:kubernetes",
    })
  }

  protected get resourceType(): string {
    return "cronjob"
  }

  /**
   * Creates a new cron job.
   */
  static create(name: string, args: CronJobArgs, opts?: ComponentResourceOptions): CronJob {
    return new CreatedCronJob(name, args, opts)
  }

  /**
   * Creates a new cron job or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the cron job name.
   * @param args The arguments to create or patch the cron job with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetCronJobArgs,
    opts?: ComponentResourceOptions,
  ): CronJob {
    if (args.existing) {
      return new CronJobPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedCronJob(name, args, opts)
  }

  /**
   * Creates a new cron job or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the cron job name. Will not be used when existing cron job is retrieved.
   * @param args The arguments to create or get the cron job with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetCronJobArgs,
    opts?: ComponentResourceOptions,
  ): Promise<CronJob> {
    if (args.existing) {
      return await CronJob.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedCronJob(name, args, opts)
  }

  /**
   * Patches an existing cron job.
   *
   * Will throw an error if the cron job does not exist.
   *
   * @param name The name of the resource. May not be the same as the cron job name.
   * @param args The arguments to patch the cron job with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: CronJobArgs, opts?: ComponentResourceOptions): CronJob {
    return new CronJobPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes cron job.
   */
  static wrap(name: string, args: WrappedCronJobArgs, opts?: ComponentResourceOptions): CronJob {
    return new WrappedCronJob(name, args, opts)
  }

  /**
   * Gets an existing cron job.
   *
   * Will throw an error if the cron job does not exist.
   */
  static get(name: string, args: ExternalCronJobArgs, opts?: ComponentResourceOptions): CronJob {
    return new ExternalCronJob(name, args, opts)
  }

  private static readonly cronJobCache = new Map<string, CronJob>()

  /**
   * Gets an existing cron job for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the cron job for.
   * @param cluster The cluster where the cron job is located.
   */
  static for(entity: k8s.NamespacedResource, cluster: Input<k8s.Cluster>): CronJob {
    return getOrCreate(
      CronJob.cronJobCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return CronJob.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing cron job for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the cron job for.
   * @param cluster The cluster where the cron job is located.
   */
  static async forAsync(
    entity: Input<k8s.NamespacedResource>,
    cluster: Input<k8s.Cluster>,
  ): Promise<CronJob> {
    const resolvedEntity = await toPromise(entity)
    return CronJob.for(resolvedEntity, cluster)
  }
}

const cronJobExtraArgs = [...commonExtraArgs, "container", "containers"] as const

class CreatedCronJob extends CronJob {
  constructor(name: string, args: CronJobArgs, opts?: ComponentResourceOptions) {
    const { podTemplate, containers, networkPolicy } = getWorkloadComponents(
      name,
      args,
      () => this,
      opts,
    )

    const cronJob = output(args.namespace).cluster.apply(cluster => {
      return new batch.v1.CronJob(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate }).apply(({ args, podTemplate }) => {
            return deepmerge(
              {
                jobTemplate: {
                  spec: {
                    template: deepmerge(
                      {
                        spec: {
                          restartPolicy: "Never",
                        },
                      },
                      podTemplate,
                    ),
                  },
                },
                schedule: args.schedule,
              },
              omit(args, cronJobExtraArgs) as types.input.batch.v1.CronJobSpec,
            )
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
      "highstate:k8s:CronJob",
      name,
      args,
      opts,
      cronJob.metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      containers,
      networkPolicy,
      cronJob.spec,
      cronJob.status,
    )
  }
}

class CronJobPatch extends CronJob {
  constructor(name: string, args: CronJobArgs, opts?: ComponentResourceOptions) {
    const { podTemplate, containers, networkPolicy } = getWorkloadComponents(
      name,
      args,
      () => this,
      opts,
      true,
    )

    const cronJob = output(args.namespace).cluster.apply(cluster => {
      return new batch.v1.CronJobPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate }).apply(({ args, podTemplate }) => {
            return deepmerge(
              {
                jobTemplate: {
                  spec: {
                    template: podTemplate,
                  },
                },
                schedule: args.schedule!,
              } satisfies types.input.batch.v1.CronJobSpec,
              omit(args, cronJobExtraArgs) as types.input.batch.v1.CronJobSpec,
            )
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
      "highstate:k8s:CronJobPatch",
      name,
      args,
      opts,
      cronJob.metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      containers,
      networkPolicy,
      cronJob.spec,
      cronJob.status,
    )
  }
}

export type WrappedCronJobArgs = {
  /**
   * The underlying Kubernetes cron job to wrap.
   */
  cronJob: Input<batch.v1.CronJob>

  /**
   * The namespace where the cron job is located.
   */
  namespace: Input<Namespace>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>
}

class WrappedCronJob extends CronJob {
  constructor(name: string, args: WrappedCronJobArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedCronJob",
      name,
      args,
      opts,

      output(args.cronJob).metadata,
      output(args.namespace),
      output(args.terminal ?? {}),
      output([]),
      output(undefined),

      output(args.cronJob).spec,
      output(args.cronJob).status,
    )
  }
}

export type ExternalCronJobArgs = {
  /**
   * The name of the cron job to get.
   */
  name: Input<string>

  /**
   * The namespace where the cron job is located.
   */
  namespace: Input<Namespace>
}

class ExternalCronJob extends CronJob {
  constructor(name: string, args: ExternalCronJobArgs, opts?: ComponentResourceOptions) {
    const cronJob = output(args.namespace).cluster.apply(cluster => {
      return batch.v1.CronJob.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalCronJob",
      name,
      args,
      opts,

      cronJob.metadata,
      output(args.namespace),
      output({}),
      output([]),
      output(undefined),

      cronJob.spec,
      cronJob.status,
    )
  }
}
