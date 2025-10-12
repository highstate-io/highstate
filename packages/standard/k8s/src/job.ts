import type { k8s } from "@highstate/library"
import type { Container } from "./container"
import type { NetworkPolicy } from "./network-policy"
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

export type JobArgs = ScopedResourceArgs &
  Omit<Partial<types.input.batch.v1.JobSpec>, "template"> & {
    template?: {
      metadata?: types.input.meta.v1.ObjectMeta
      spec?: Partial<types.input.core.v1.PodSpec>
    }
  } & WorkloadArgs

export type CreateOrGetJobArgs = JobArgs & {
  /**
   * The job entity to patch/retrieve.
   */
  existing: Input<k8s.ScopedResource> | undefined
}

/**
 * Represents a Kubernetes Job resource with metadata and spec.
 */
export abstract class Job extends Workload {
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

    /**
     * The spec of the underlying Kubernetes job.
     */
    readonly spec: Output<types.output.batch.v1.JobSpec>,

    /**
     * The status of the underlying Kubernetes job.
     */
    readonly status: Output<types.output.batch.v1.JobStatus>,
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
    )
  }

  protected override get templateMetadata(): Output<types.output.meta.v1.ObjectMeta> {
    return this.spec.template.metadata
  }

  /**
   * The Highstate job entity.
   */
  get entity(): Output<k8s.ScopedResource> {
    return output({
      type: "job",
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      metadata: this.metadata,
    })
  }

  protected getTerminalMeta(): Output<UnitTerminal["meta"]> {
    return output({
      title: "Job",
      globalTitle: interpolate`Job | ${this.metadata.name}`,
      description: "The shell inside the job.",
      icon: "devicon:kubernetes",
    })
  }

  protected get resourceType(): string {
    return "job"
  }

  /**
   * Creates a new job.
   */
  static create(name: string, args: JobArgs, opts?: ComponentResourceOptions): Job {
    return new CreatedJob(name, args, opts)
  }

  /**
   * Creates a new job or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the job name.
   * @param args The arguments to create or patch the job with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetJobArgs,
    opts?: ComponentResourceOptions,
  ): Job {
    if (args.existing) {
      return new JobPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
        namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
      })
    }

    return new CreatedJob(name, args, opts)
  }

  /**
   * Creates a new job or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the job name. Will not be used when existing job is retrieved.
   * @param args The arguments to create or get the job with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetJobArgs,
    opts?: ComponentResourceOptions,
  ): Promise<Job> {
    if (args.existing) {
      return await Job.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedJob(name, args, opts)
  }

  /**
   * Patches an existing job.
   *
   * Will throw an error if the job does not exist.
   *
   * @param name The name of the resource. May not be the same as the job name.
   * @param args The arguments to patch the job with.
   * @param opts Optional resource options.
   */
  static patch(name: string, args: JobArgs, opts?: ComponentResourceOptions): Job {
    return new JobPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes job.
   */
  static wrap(name: string, args: WrappedJobArgs, opts?: ComponentResourceOptions): Job {
    return new WrappedJob(name, args, opts)
  }

  /**
   * Gets an existing job.
   *
   * Will throw an error if the job does not exist.
   */
  static get(name: string, args: ExternalJobArgs, opts?: ComponentResourceOptions): Job {
    return new ExternalJob(name, args, opts)
  }

  private static readonly jobCache = new Map<string, Job>()

  /**
   * Gets an existing job for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the job for.
   * @param cluster The cluster where the job is located.
   */
  static for(entity: k8s.ScopedResource, cluster: Input<k8s.Cluster>): Job {
    return getOrCreate(
      Job.jobCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return Job.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing job for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the job for.
   * @param cluster The cluster where the job is located.
   */
  static async forAsync(
    entity: Input<k8s.ScopedResource>,
    cluster: Input<k8s.Cluster>,
  ): Promise<Job> {
    const resolvedEntity = await toPromise(entity)
    return Job.for(resolvedEntity, cluster)
  }
}

const jobExtraArgs = [...commonExtraArgs, "container", "containers"] as const

class CreatedJob extends Job {
  constructor(name: string, args: JobArgs, opts?: ComponentResourceOptions) {
    const { podTemplate, containers, networkPolicy } = getWorkloadComponents(
      name,
      args,
      () => this,
      opts,
    )

    const job = output(args.namespace).cluster.apply(cluster => {
      return new batch.v1.Job(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate }).apply(({ args, podTemplate }) => {
            return deepmerge(
              {
                template: deepmerge(
                  {
                    spec: {
                      restartPolicy: "Never",
                    },
                  },
                  podTemplate,
                ),
              },
              omit(args, jobExtraArgs) as types.input.batch.v1.JobSpec,
            )
          }),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:Job",
      name,
      args,
      opts,

      job.apiVersion,
      job.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      job.metadata,
      networkPolicy,

      job.spec,
      job.status,
    )
  }
}

class JobPatch extends Job {
  constructor(name: string, args: JobArgs, opts?: ComponentResourceOptions) {
    const { podTemplate, containers, networkPolicy } = getWorkloadComponents(
      name,
      args,
      () => this,
      opts,
    )

    const job = output(args.namespace).cluster.apply(cluster => {
      return new batch.v1.JobPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output({ args, podTemplate }).apply(({ args, podTemplate }) => {
            return deepmerge(
              { template: podTemplate } satisfies types.input.batch.v1.JobSpec,
              omit(args, jobExtraArgs) as types.input.batch.v1.JobSpec,
            )
          }),
        },
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:JobPatch",
      name,
      args,
      opts,

      job.apiVersion,
      job.kind,
      output(args.terminal ?? {}),
      containers,
      output(args.namespace),
      job.metadata,
      networkPolicy,

      job.spec,
      job.status,
    )

    this.registerOutputs({
      metadata: this.metadata,
      spec: this.spec,
      status: this.status,
    })
  }
}

export type WrappedJobArgs = {
  /**
   * The underlying Kubernetes job to wrap.
   */
  job: Input<batch.v1.Job>

  /**
   * The namespace where the job is located.
   */
  namespace: Input<Namespace>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>
}

class WrappedJob extends Job {
  constructor(name: string, args: WrappedJobArgs, opts?: ComponentResourceOptions) {
    super(
      "highstate:k8s:WrappedJob",
      name,
      args,
      opts,

      output(args.job).apiVersion,
      output(args.job).kind,
      output(args.terminal ?? {}),
      output([]),
      output(args.namespace),
      output(args.job).metadata,
      output(undefined),

      output(args.job).spec,
      output(args.job).status,
    )
  }
}

export type ExternalJobArgs = {
  /**
   * The name of the job to get.
   */
  name: Input<string>

  /**
   * The namespace where the job is located.
   */
  namespace: Input<Namespace>
}

class ExternalJob extends Job {
  constructor(name: string, args: ExternalJobArgs, opts?: ComponentResourceOptions) {
    const job = output(args.namespace).cluster.apply(cluster => {
      return batch.v1.Job.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalJob",
      name,
      args,
      opts,

      job.apiVersion,
      job.kind,
      output({}),
      output([]),
      output(args.namespace),
      job.metadata,
      output(undefined),

      job.spec,
      job.status,
    )
  }
}
