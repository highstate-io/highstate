import type { k8s } from "@highstate/library"
import { getOrCreate } from "@highstate/contract"
import {
  type ComponentResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  type Output,
  output,
  toPromise,
} from "@highstate/pulumi"
import { core, type types } from "@pulumi/kubernetes"
import { deepmerge } from "deepmerge-ts"
import { omit } from "remeda"
import { Namespace } from "./namespace"
import {
  commonExtraArgs,
  getProvider,
  mapMetadata,
  ScopedResource,
  type ScopedResourceArgs,
} from "./shared"

export type PersistentVolumeClaimArgs = ScopedResourceArgs &
  types.input.core.v1.PersistentVolumeClaimSpec & {
    /**
     * The size of the volume to request.
     *
     * By default, the size is set to "100Mi".
     */
    size?: string
  }

export type CreateOrGetPersistentVolumeClaimArgs = PersistentVolumeClaimArgs & {
  /**
   * The PVC entity to patch/retrieve.
   */
  existing: Input<k8s.PersistentVolumeClaim> | undefined
}

const extraPersistentVolumeClaimArgs = [...commonExtraArgs, "size"] as const

/**
 * Represents a Kubernetes PersistentVolumeClaim resource with metadata and spec.
 */
export abstract class PersistentVolumeClaim extends ScopedResource {
  protected constructor(
    type: string,
    name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    apiVersion: Output<string>,
    kind: Output<string>,
    namespace: Output<Namespace>,
    metadata: Output<types.output.meta.v1.ObjectMeta>,

    /**
     * The spec of the underlying Kubernetes PVC.
     */
    readonly spec: Output<types.output.core.v1.PersistentVolumeClaimSpec>,

    /**
     * The status of the underlying Kubernetes PVC.
     */
    readonly status: Output<types.output.core.v1.PersistentVolumeClaimStatus>,
  ) {
    super(type, name, args, opts, apiVersion, kind, namespace, metadata)
  }

  /**
   * The Highstate PVC entity.
   */
  get entity(): Output<k8s.PersistentVolumeClaim> {
    return output({
      type: "persistent-volume-claim",
      clusterId: this.cluster.id,
      clusterName: this.cluster.name,
      metadata: this.metadata,
    })
  }

  /**
   * Creates a new PVC.
   */
  static create(
    name: string,
    args: PersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): PersistentVolumeClaim {
    return new CreatedPersistentVolumeClaim(name, args, opts)
  }

  /**
   * Creates a new PVC or patches an existing one.
   *
   * @param name The name of the resource. May not be the same as the PVC name.
   * @param args The arguments to create or patch the PVC with.
   * @param opts Optional resource options.
   */
  static createOrPatch(
    name: string,
    args: CreateOrGetPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): PersistentVolumeClaim {
    if (args.existing) {
      return new PersistentVolumeClaimPatch(name, {
        ...args,
        name: output(args.existing).metadata.name,
      })
    }

    return new CreatedPersistentVolumeClaim(name, args, opts)
  }

  /**
   * Creates a new PVC or gets an existing one.
   *
   * @param name The name of the resource. May not be the same as the PVC name. Will not be used when existing PVC is retrieved.
   * @param args The arguments to create or get the PVC with.
   * @param opts Optional resource options.
   */
  static async createOrGet(
    name: string,
    args: CreateOrGetPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): Promise<PersistentVolumeClaim> {
    if (args.existing) {
      return await PersistentVolumeClaim.forAsync(args.existing, output(args.namespace).cluster)
    }

    return new CreatedPersistentVolumeClaim(name, args, opts)
  }

  /**
   * Patches an existing PVC.
   *
   * Will throw an error if the PVC does not exist.
   *
   * @param name The name of the resource. May not be the same as the PVC name.
   * @param args The arguments to patch the PVC with.
   * @param opts Optional resource options.
   */
  static patch(
    name: string,
    args: PersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): PersistentVolumeClaim {
    return new PersistentVolumeClaimPatch(name, args, opts)
  }

  /**
   * Wraps an existing Kubernetes PVC.
   */
  static wrap(
    name: string,
    args: WrappedPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): PersistentVolumeClaim {
    return new WrappedPersistentVolumeClaim(name, args, opts)
  }

  /**
   * Gets an existing PVC.
   *
   * Will throw an error if the PVC does not exist.
   */
  static get(
    name: string,
    args: ExternalPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ): PersistentVolumeClaim {
    return new ExternalPersistentVolumeClaim(name, args, opts)
  }

  private static readonly pvcCache = new Map<string, PersistentVolumeClaim>()

  /**
   * Gets an existing PVC for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the PVC for.
   * @param cluster The cluster where the PVC is located.
   */
  static for(
    entity: k8s.PersistentVolumeClaim,
    cluster: Input<k8s.Cluster>,
  ): PersistentVolumeClaim {
    return getOrCreate(
      PersistentVolumeClaim.pvcCache,
      `${entity.clusterName}.${entity.metadata.namespace}.${entity.metadata.name}.${entity.clusterId}`,
      name => {
        return PersistentVolumeClaim.get(name, {
          name: entity.metadata.name,
          namespace: Namespace.forResource(entity, cluster),
        })
      },
    )
  }

  /**
   * Gets an existing PVC for a given entity.
   * Prefer this method over `get` when possible.
   *
   * It automatically names the resource with the following format: `{clusterName}.{namespace}.{name}.{clusterId}`.
   *
   * This method is idempotent and will return the same instance for the same entity.
   *
   * @param entity The entity to get the PVC for.
   * @param cluster The cluster where the PVC is located.
   */
  static async forAsync(
    entity: Input<k8s.PersistentVolumeClaim>,
    cluster: Input<k8s.Cluster>,
  ): Promise<PersistentVolumeClaim> {
    const resolvedEntity = await toPromise(entity)
    return PersistentVolumeClaim.for(resolvedEntity, cluster)
  }
}

class CreatedPersistentVolumeClaim extends PersistentVolumeClaim {
  constructor(name: string, args: PersistentVolumeClaimArgs, opts?: ComponentResourceOptions) {
    const pvc = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.PersistentVolumeClaim(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output(args).apply(args => {
            return deepmerge(
              {
                accessModes: ["ReadWriteOnce"],
                resources: {
                  requests: {
                    storage: args.size ?? "100Mi",
                  },
                },
              } satisfies types.input.core.v1.PersistentVolumeClaimSpec,
              omit(args, extraPersistentVolumeClaimArgs),
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
      "highstate:k8s:PersistentVolumeClaim",
      name,
      args,
      opts,

      pvc.apiVersion,
      pvc.kind,
      output(args.namespace),
      pvc.metadata,
      pvc.spec,
      pvc.status,
    )
  }
}

class PersistentVolumeClaimPatch extends PersistentVolumeClaim {
  constructor(name: string, args: PersistentVolumeClaimArgs, opts?: ComponentResourceOptions) {
    const pvc = output(args.namespace).cluster.apply(cluster => {
      return new core.v1.PersistentVolumeClaimPatch(
        name,
        {
          metadata: mapMetadata(args, name),
          spec: output(args).apply(args => {
            return deepmerge(
              {
                accessModes: ["ReadWriteOnce"],
                resources: {
                  requests: {
                    storage: args.size ?? "100Mi",
                  },
                },
              } satisfies types.input.core.v1.PersistentVolumeClaimSpec,
              omit(args, extraPersistentVolumeClaimArgs),
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
      "highstate:k8s:PersistentVolumeClaimPatch",
      name,
      args,
      opts,

      pvc.apiVersion,
      pvc.kind,
      output(args.namespace),
      pvc.metadata,
      pvc.spec,
      pvc.status,
    )
  }
}

export type WrappedPersistentVolumeClaimArgs = {
  /**
   * The underlying Kubernetes PVC to wrap.
   */
  pvc: Input<core.v1.PersistentVolumeClaim>

  /**
   * The namespace where the PVC is located.
   */
  namespace: Input<Namespace>
}

class WrappedPersistentVolumeClaim extends PersistentVolumeClaim {
  constructor(
    name: string,
    args: WrappedPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(
      "highstate:k8s:WrappedPersistentVolumeClaim",
      name,
      args,
      opts,

      output(args.pvc).apiVersion,
      output(args.pvc).kind,
      output(args.namespace),
      output(args.pvc).metadata,
      output(args.pvc).spec,
      output(args.pvc).status,
    )
  }
}

export type ExternalPersistentVolumeClaimArgs = {
  /**
   * The name of the PVC to get.
   */
  name: Input<string>

  /**
   * The namespace where the PVC is located.
   */
  namespace: Input<Namespace>
}

class ExternalPersistentVolumeClaim extends PersistentVolumeClaim {
  constructor(
    name: string,
    args: ExternalPersistentVolumeClaimArgs,
    opts?: ComponentResourceOptions,
  ) {
    const pvc = output(args.namespace).cluster.apply(cluster => {
      return core.v1.PersistentVolumeClaim.get(
        name,
        interpolate`${output(args.namespace).metadata.name}/${args.name}`,
        { ...opts, parent: this, provider: getProvider(cluster) },
      )
    })

    super(
      "highstate:k8s:ExternalPersistentVolumeClaim",
      name,
      args,
      opts,

      pvc.apiVersion,
      pvc.kind,
      output(args.namespace),
      pvc.metadata,
      pvc.spec,
      pvc.status,
    )
  }
}

export function getAutoVolumeName(workloadName: string, index: number): string {
  if (index === 0) {
    return `${workloadName}-data`
  }

  return `${workloadName}-data-${index}`
}
