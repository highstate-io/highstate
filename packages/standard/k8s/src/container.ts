import type { PartialKeys } from "@highstate/contract"
import type { k8s, network } from "@highstate/library"
import {
  type Input,
  type InputArray,
  normalize,
  type Output,
  output,
  type Unwrap,
} from "@highstate/pulumi"
import { core, type types } from "@pulumi/kubernetes"
import { concat, map, omit } from "remeda"
import { ConfigMap } from "./config-map"
import { PersistentVolumeClaim } from "./pvc"
import { Secret } from "./secret"

export type Container = Omit<PartialKeys<types.input.core.v1.Container, "name">, "volumeMounts"> & {
  /**
   * The single port to add to the container.
   */
  port?: Input<types.input.core.v1.ContainerPort>

  /**
   * The volume mount to attach to the container.
   */
  volumeMount?: Input<ContainerVolumeMount>

  /**
   * The volume mounts to attach to the container.
   */
  volumeMounts?: InputArray<ContainerVolumeMount>

  /**
   * The volume to include in the parent workload.
   * It is like the `volumes` property, but defined at the container level.
   * It will be defined as a volume mount in the parent workload automatically.
   */
  volume?: Input<WorkloadVolume>

  /**
   * The volumes to include in the parent workload.
   * It is like the `volumes` property, but defined at the container level.
   * It will be defined as a volume mount in the parent workload automatically.
   */
  volumes?: InputArray<WorkloadVolume>

  /**
   * The map of environment variables to set in the container.
   * It is like the `env` property, but more convenient to use.
   */
  environment?: Input<ContainerEnvironment>

  /**
   * The source of environment variables to set in the container.
   * It is like the `envFrom` property, but more convenient to use.
   */
  environmentSource?: Input<ContainerEnvironmentSource>

  /**
   * The sources of environment variables to set in the container.
   * It is like the `envFrom` property, but more convenient to use.
   */
  environmentSources?: InputArray<ContainerEnvironmentSource>

  /**
   * The list of endpoints that the container is allowed to access.
   *
   * This is used to generate a network policy.
   */
  allowedEndpoints?: InputArray<network.L34Endpoint>

  /**
   * Enable the TUN device in the container.
   *
   * All necessary security context settings will be applied to the container.
   */
  enableTun?: Input<boolean>
}

const containerExtraArgs = [
  "port",
  "volumeMount",
  "volume",
  "environment",
  "environmentSource",
  "environmentSources",
] as const

export type ContainerEnvironment = Record<
  string,
  Input<string | undefined | null | ContainerEnvironmentVariable>
>

export type ContainerEnvironmentVariable =
  | types.input.core.v1.EnvVarSource
  | {
      /**
       * The secret to select from.
       */
      secret: Input<core.v1.Secret | Secret>

      /**
       * The key of the secret to select from.
       */
      key: string
    }
  | {
      /**
       * The config map to select from.
       */
      configMap: Input<core.v1.ConfigMap>

      /**
       * The key of the config map to select from.
       */
      key: string
    }

export type ContainerEnvironmentSource =
  | types.input.core.v1.EnvFromSource
  | core.v1.ConfigMap
  | core.v1.Secret

export type ContainerVolumeMount =
  | types.input.core.v1.VolumeMount
  | (Omit<types.input.core.v1.VolumeMount, "name"> & {
      /**
       * The volume to mount.
       */
      volume: Input<WorkloadVolume>
    })

export type WorkloadVolume =
  | types.input.core.v1.Volume
  | core.v1.PersistentVolumeClaim
  | PersistentVolumeClaim
  | core.v1.ConfigMap
  | ConfigMap
  | core.v1.Secret
  | Secret

export function getFallbackContainerName(name: string, index: number) {
  if (index === 0) {
    return name
  }

  return `${name}-${index}`
}

export function mapContainerToRaw(
  container: Unwrap<Container>,
  cluster: k8s.Cluster,
  fallbackName: string,
): types.input.core.v1.Container {
  const containerName = container.name ?? fallbackName

  const spec = {
    ...omit(container, containerExtraArgs),

    name: containerName,
    ports: normalize(container.port, container.ports),

    volumeMounts: map(normalize(container.volumeMount, container.volumeMounts), mapVolumeMount),

    env: concat(
      container.environment ? mapContainerEnvironment(container.environment) : [],
      container.env ?? [],
    ),

    envFrom: concat(
      map(
        normalize(container.environmentSource, container.environmentSources),
        mapEnvironmentSource,
      ),
      container.envFrom ?? [],
    ),
  } as Unwrap<types.input.core.v1.Container>

  if (container.enableTun) {
    spec.securityContext ??= {}
    spec.securityContext.capabilities ??= {}
    spec.securityContext.capabilities.add = ["NET_ADMIN"]

    if (cluster.quirks?.tunDevicePolicy?.type === "plugin") {
      spec.resources ??= {}
      spec.resources.limits ??= {}
      spec.resources.limits[cluster.quirks.tunDevicePolicy.resourceName] =
        cluster.quirks.tunDevicePolicy.resourceValue
    } else {
      spec.volumeMounts ??= []
      spec.volumeMounts.push({
        name: "tun-device",
        mountPath: "/dev/net/tun",
        readOnly: false,
      })
    }
  }

  return spec
}

export function mapContainerEnvironment(
  environment: Unwrap<ContainerEnvironment>,
): types.input.core.v1.EnvVar[] {
  const envVars: types.input.core.v1.EnvVar[] = []

  for (const [name, value] of Object.entries(environment)) {
    if (!value) {
      continue
    }

    if (typeof value === "string") {
      envVars.push({ name, value })
      continue
    }

    if ("secret" in value) {
      envVars.push({
        name,
        valueFrom: {
          secretKeyRef: {
            name: value.secret.metadata.name,
            key: value.key,
          },
        },
      })
      continue
    }

    if ("configMap" in value) {
      envVars.push({
        name,
        valueFrom: {
          configMapKeyRef: {
            name: value.configMap.metadata.name,
            key: value.key,
          },
        },
      })
      continue
    }

    envVars.push({ name, valueFrom: value })
  }

  return envVars
}

export function mapVolumeMount(volumeMount: ContainerVolumeMount): types.input.core.v1.VolumeMount {
  if ("volume" in volumeMount) {
    return omit(
      {
        ...volumeMount,
        name: output(volumeMount.volume)
          .apply(mapWorkloadVolume)
          .apply(volume => output(volume.name)),
      },
      ["volume"],
    )
  }

  return {
    ...volumeMount,
    name: volumeMount.name,
  }
}

export function mapEnvironmentSource(
  envFrom: ContainerEnvironmentSource,
): types.input.core.v1.EnvFromSource {
  if (envFrom instanceof core.v1.ConfigMap) {
    return {
      configMapRef: {
        name: envFrom.metadata.name,
      },
    }
  }

  if (envFrom instanceof core.v1.Secret) {
    return {
      secretRef: {
        name: envFrom.metadata.name,
      },
    }
  }

  return envFrom
}

export function mapWorkloadVolume(volume: WorkloadVolume) {
  if (volume instanceof PersistentVolumeClaim) {
    return {
      name: volume.metadata.name,
      persistentVolumeClaim: {
        claimName: volume.metadata.name,
      },
    }
  }

  if (volume instanceof Secret) {
    return {
      name: volume.metadata.name,
      secret: {
        secretName: volume.metadata.name,
      },
    }
  }

  if (volume instanceof ConfigMap) {
    return {
      name: volume.metadata.name,
      configMap: {
        name: volume.metadata.name,
      },
    }
  }

  if (core.v1.PersistentVolumeClaim.isInstance(volume)) {
    return {
      name: volume.metadata.name,
      persistentVolumeClaim: {
        claimName: volume.metadata.name,
      },
    }
  }

  if (core.v1.ConfigMap.isInstance(volume)) {
    return {
      name: volume.metadata.name,
      configMap: {
        name: volume.metadata.name,
      },
    }
  }

  if (core.v1.Secret.isInstance(volume)) {
    return {
      name: volume.metadata.name,
      secret: {
        secretName: volume.metadata.name,
      },
    }
  }

  return volume
}

export function getWorkloadVolumeResourceUuid(volume: WorkloadVolume): Output<string | undefined> {
  if (volume instanceof PersistentVolumeClaim) {
    return volume.metadata.uid
  }

  if (volume instanceof Secret) {
    return volume.metadata.uid
  }

  if (volume instanceof ConfigMap) {
    return volume.metadata.uid
  }

  if (core.v1.PersistentVolumeClaim.isInstance(volume)) {
    return volume.metadata.uid
  }

  if (core.v1.ConfigMap.isInstance(volume)) {
    return volume.metadata.uid
  }

  if (core.v1.Secret.isInstance(volume)) {
    return volume.metadata.uid
  }

  return output(undefined)
}
