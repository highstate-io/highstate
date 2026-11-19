import type { k8s } from "@highstate/library"
import type { Input } from "@highstate/pulumi"
import { Namespace } from "@highstate/k8s"
import { toPromise } from "@highstate/pulumi"

/**
 * Wrap an existing namespace without requiring namespace creation privileges.
 */
export async function resolveExistingNamespace(
  cluster: Input<k8s.Cluster>,
  existing: Input<k8s.Namespace> | undefined,
  expectedName?: string,
): Promise<Namespace | undefined> {
  if (!existing) {
    return undefined
  }

  const entity = await toPromise(existing)
  if (expectedName && entity.metadata.name !== expectedName) {
    throw new Error("The supplied namespace must match the namespace argument or volume")
  }

  const matchingCluster = await toPromise(cluster)
  if (entity.clusterId !== matchingCluster.id) {
    throw new Error(`Cluster mismatch for Namespace "${entity.metadata.name}"`)
  }

  return Namespace.fromEntity(entity, matchingCluster)
}

/**
 * Shared namespace selection for Kubernetes apps; supplied capabilities are never owned.
 */
export async function createAppNamespace(
  args: { appName: string; namespace?: string; existingNamespace?: string },
  inputs: {
    k8sCluster: Input<k8s.Cluster>
    namespace?: Input<k8s.Namespace>
    volume?: Input<k8s.PersistentVolumeClaim>
  },
  options: { privileged?: boolean; retainOnDelete?: boolean } = {},
): Promise<Namespace> {
  const existing = await resolveExistingNamespace(
    inputs.k8sCluster,
    inputs.namespace,
    args.existingNamespace ?? args.namespace,
  )

  if (existing) {
    if (inputs.volume) {
      const volume = await toPromise(inputs.volume)
      const namespace = await toPromise(existing.metadata)
      const cluster = await toPromise(inputs.k8sCluster)

      if (volume.clusterId !== cluster.id) {
        throw new Error(`Cluster mismatch for PersistentVolumeClaim "${volume.metadata.name}"`)
      }

      if (volume.metadata.namespace !== namespace.name) {
        throw new Error("The supplied namespace and volume must belong to the same namespace")
      }
    }

    return existing
  }

  if (args.existingNamespace) {
    return Namespace.get(args.existingNamespace, {
      name: args.existingNamespace,
      cluster: inputs.k8sCluster,
    })
  }

  if (inputs.volume) {
    return await Namespace.createOrGet(args.namespace ?? args.appName, {
      cluster: inputs.k8sCluster,
      resource: inputs.volume,
    })
  }

  return Namespace.create(
    args.namespace ?? args.appName,
    {
      cluster: inputs.k8sCluster,
      privileged: options.privileged,
    },
    options.retainOnDelete ? { retainOnDelete: true } : undefined,
  )
}
