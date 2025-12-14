import type { k8s } from "@highstate/library"
import type { types } from "@pulumi/kubernetes"
import type { Except } from "type-fest"
import type { DeploymentArgs } from "./deployment"
import type { StatefulSetArgs } from "./stateful-set"
import { AccessPointRoute, type AccessPointRouteArgs } from "@highstate/common"
import { type TerminalSpec, trimIndentation, type UnitTerminal } from "@highstate/contract"
import {
  type ComponentResourceOptions,
  type DeepInput,
  fileFromString,
  type InputArray,
  normalize,
  normalizeInputs,
} from "@highstate/pulumi"
import {
  type ComponentResource,
  type CustomResourceOptions,
  type Input,
  type Inputs,
  interpolate,
  type Output,
  output,
  type Unwrap,
} from "@pulumi/pulumi"
import { sha256 } from "crypto-hash"
import { deepmerge } from "deepmerge-ts"
import { filter, isNonNullish, unique, uniqueBy } from "remeda"
import {
  type Container,
  getFallbackContainerName,
  getWorkloadVolumeResourceUuid,
  mapContainerToRaw,
  mapWorkloadVolume,
  type WorkloadVolume,
} from "./container"
import { Namespace } from "./namespace"
import { NetworkPolicy, type NetworkPolicyArgs } from "./network-policy"
import { podSpecDefaults } from "./pod"
import { mapContainerPortToServicePort, Service, type ServiceArgs } from "./service"
import { commonExtraArgs, images, ScopedResource, type ScopedResourceArgs } from "./shared"

export type WorkloadTerminalArgs = {
  /**
   * The shell to use in the terminal.
   *
   * By default, `bash` is used.
   */
  shell?: string
}

export type WorkloadArgs = ScopedResourceArgs & {
  /**
   * The init container to include in the workload.
   */
  initContainer?: Input<Container>

  /**
   * The init containers to include in the workload.
   */
  initContainers?: InputArray<Container>

  /**
   * The container to include in the workload.
   */
  container?: Input<Container>

  /**
   * The containers to include in the workload.
   */
  containers?: InputArray<Container>

  /**
   * The args for the terminal to use.
   */
  terminal?: Input<WorkloadTerminalArgs>

  /**
   * The network policy to apply to the deployment.
   */
  networkPolicy?: Omit<NetworkPolicyArgs, "selector" | "cluster" | "namespace">
}

export const workloadExtraArgs = [...commonExtraArgs, "container", "containers"] as const

export type ExposableWorkloadRouteArgs = Except<
  AccessPointRouteArgs,
  "endpoints" | "gatewayNativeData" | "tlsCertificateNativeData"
>

export type ExposableWorkloadArgs = WorkloadArgs & {
  service?: Input<Omit<ServiceArgs, "cluster" | "namespace">>

  /**
   * The configuration for the access point route to create.
   */
  route?: Input<ExposableWorkloadRouteArgs>

  /**
   * The configuration for the access point routes to create.
   */
  routes?: InputArray<ExposableWorkloadRouteArgs>

  /**
   * The existing workload to patch.
   */
  existing?: Input<k8s.ExposableWorkload>
}

export const exposableWorkloadExtraArgs = [
  ...workloadExtraArgs,
  "service",
  "route",
  "routes",
] as const

export type ExposableWorkloadType = "Deployment" | "StatefulSet"

export type GenericExposableWorkloadArgs = Omit<ExposableWorkloadArgs, "existing"> & {
  /**
   * The type of workload to create.
   *
   * Will be ignored if the `existing` argument is provided.
   */
  type: ExposableWorkloadType

  /**
   * The existing workload to patch.
   */
  existing: Input<k8s.ExposableWorkload | undefined>

  /**
   * The args specific to the "Deployment" workload type.
   *
   * Will be ignored for other workload types.
   */
  deployment?: Input<DeploymentArgs>

  /**
   * The args specific to the "StatefulSet" workload type.
   *
   * Will be ignored for other workload types.
   */
  statefulSet?: Input<StatefulSetArgs>
}

export function getWorkloadComponents(
  name: string,
  args: WorkloadArgs,
  parent: () => ComponentResource,
  opts: ComponentResourceOptions | undefined,
  isForPatch?: boolean,
) {
  // do not set labels when patching to avoid overwriting existing labels
  const labels = isForPatch ? undefined : { "app.kubernetes.io/name": name }

  const containers = output(args).apply(args => normalize(args.container, args.containers))
  const initContainers = output(args).apply(args =>
    normalize(args.initContainer, args.initContainers),
  )

  const rawVolumes = output({ containers, initContainers }).apply(
    ({ containers, initContainers }) => {
      const containerVolumes = [...containers, ...initContainers].flatMap(container =>
        normalize(container.volume, container.volumes),
      )

      const containerVolumeMounts = containers.flatMap(container => {
        return normalize(container.volumeMount, container.volumeMounts)
          .map(volumeMount => {
            return "volume" in volumeMount ? volumeMount.volume : undefined
          })
          .filter(Boolean) as WorkloadVolume[]
      })

      return output([...containerVolumes, ...containerVolumeMounts])
    },
  )

  const volumes = rawVolumes.apply(rawVolumes => {
    return output(rawVolumes.map(mapWorkloadVolume)).apply(uniqueBy(volume => volume.name))
  })

  const podSpec = output({
    cluster: output(args.namespace).cluster,
    containers,
    initContainers,
    volumes,
  }).apply(({ cluster, containers, initContainers, volumes }) => {
    const spec = {
      volumes,
      containers: containers.map((container, index) =>
        mapContainerToRaw(container, cluster, getFallbackContainerName(name, index)),
      ),
      initContainers: initContainers.map((container, index) =>
        mapContainerToRaw(container, cluster, getFallbackContainerName(`init-${name}`, index)),
      ),
      ...podSpecDefaults,
    } satisfies types.input.core.v1.PodSpec

    if (
      containers.some(container => container.enableTun) &&
      cluster.quirks?.tunDevicePolicy?.type !== "plugin"
    ) {
      spec.volumes = output(spec.volumes).apply(volumes => [
        ...(volumes ?? []),
        {
          name: "tun-device",
          hostPath: {
            path: "/dev/net/tun",
          },
        },
      ])
    }

    return spec
  })

  const dependencyHash = rawVolumes.apply(rawVolumes => {
    return output(rawVolumes.map(getWorkloadVolumeResourceUuid))
      .apply(filter(isNonNullish))
      .apply(unique())
      .apply(ids => sha256(ids.join(",")))
  })

  const podTemplate = output({ podSpec, dependencyHash }).apply(({ podSpec, dependencyHash }) => {
    return {
      metadata: {
        labels,
        annotations: {
          // to trigger a redeployment when the volumes change
          // we embed a hash as annotation name (not value) to allow patching without conflicts
          [`highstate.io/dependency-hash-${dependencyHash}`]: "1",
        },
      },
      spec: podSpec,
    } satisfies types.input.core.v1.PodTemplateSpec
  })

  const networkPolicy = output({ containers }).apply(({ containers }) => {
    if (isForPatch) {
      return output(undefined)
    }

    const allowedEndpoints = containers.flatMap(container => container.allowedEndpoints ?? [])

    if (allowedEndpoints.length === 0 && !args.networkPolicy) {
      return output(undefined)
    }

    return output(
      new NetworkPolicy(
        name,
        {
          namespace: args.namespace,
          selector: labels,
          description: `Network policy for "${name}"`,

          ...args.networkPolicy,

          egressRules: output(args.networkPolicy?.egressRules).apply(egressRules => [
            ...(egressRules ?? []),
            ...(allowedEndpoints.length > 0 ? [{ toEndpoints: allowedEndpoints }] : []),
          ]),
        },
        { ...opts, parent: parent() },
      ),
    )
  })

  return { labels, containers, volumes, podSpec, podTemplate, networkPolicy }
}

export function getExposableWorkloadComponents(
  name: string,
  args: ExposableWorkloadArgs,
  parent: () => ComponentResource,
  opts: ComponentResourceOptions | undefined,
  isForPatch?: boolean,
) {
  const { labels, containers, volumes, podSpec, podTemplate, networkPolicy } =
    getWorkloadComponents(name, args, parent, opts, isForPatch)

  const service = output({
    existing: args.existing,
    serviceArgs: args.service,
    containers,
  }).apply(({ existing, serviceArgs, containers }) => {
    if (!args.service && !args.route && !args.routes) {
      return undefined
    }

    if (existing?.service) {
      return Service.for(existing.service, output(args.namespace).cluster)
    }

    if (existing) {
      return undefined
    }

    const ports = containers.flatMap(container => normalize(container.port, container.ports))

    return Service.create(name, {
      ...serviceArgs,
      selector: labels,
      namespace: args.namespace,

      ports:
        // allow to completely override the ports
        !serviceArgs?.port && !serviceArgs?.ports
          ? ports.map(mapContainerPortToServicePort)
          : serviceArgs?.ports,
    })
  })

  const routes = output({
    routesArgs: normalizeInputs(args.route, args.routes),
    service,
    namespace: output(args.namespace),
  }).apply(({ routesArgs, service, namespace }) => {
    if (!routesArgs.length || !service) {
      return []
    }

    if (args.existing) {
      return []
    }

    return routesArgs.map((routeArgs, index) => {
      return new AccessPointRoute(`${name}.${index}`, {
        ...routeArgs,
        endpoints: service.endpoints,

        // pass the native data to the route to allow implementation to use it
        gatewayNativeData: service,
        tlsCertificateNativeData: namespace,
      })
    })
  })

  return { labels, containers, volumes, podSpec, podTemplate, networkPolicy, service, routes }
}

export abstract class Workload extends ScopedResource {
  protected constructor(
    type: string,
    protected readonly name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    apiVersion: Output<string>,
    kind: Output<string>,
    protected readonly terminalArgs: Output<Unwrap<WorkloadTerminalArgs>>,
    protected readonly containers: Output<Container[]>,
    namespace: Output<Namespace>,
    metadata: Output<types.output.meta.v1.ObjectMeta>,

    /**
     * The rendered pod template of the workload.
     */
    readonly podTemplate: Output<types.output.core.v1.PodTemplateSpec>,

    /**
     * The network policy associated with the workload.
     *
     * Will be created if one or more containers have `allowedEndpoints` defined.
     */
    readonly networkPolicy: Output<NetworkPolicy | undefined>,
  ) {
    super(type, name, args, opts, apiVersion, kind, namespace, metadata)
  }

  protected abstract get templateMetadata(): Output<types.output.meta.v1.ObjectMeta>

  protected abstract getTerminalMeta(): Output<UnitTerminal["meta"]>

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set terminal(_value: never) {}

  /**
   * The instance terminal to interact with the deployment.
   */
  get terminal(): Output<UnitTerminal> {
    const containerName = this.podTemplate.spec.containers.apply(containers => containers[0].name)

    const shell = this.terminalArgs.apply(args => args.shell ?? "bash")

    const podLabelSelector = this.templateMetadata
      .apply(meta => meta.labels ?? {})
      .apply(labels =>
        Object.entries(labels)
          .map(([key, value]) => `${key}=${value}`)
          .join(","),
      )

    return output({
      name: this.metadata.name,
      meta: this.getTerminalMeta(),

      spec: {
        image: images["terminal-kubectl"].image,
        command: ["bash", "/welcome.sh"],

        files: {
          "/kubeconfig": fileFromString("kubeconfig", this.cluster.kubeconfig, { isSecret: true }),

          "/welcome.sh": fileFromString(
            "welcome.sh",
            interpolate`
              #!/bin/bash
              set -euo pipefail

              NAMESPACE="${this.metadata.namespace}"
              RESOURCE_TYPE="${this.kind.apply(k => k.toLowerCase())}"
              RESOURCE_NAME="${this.metadata.name}"
              CONTAINER_NAME="${containerName}"
              SHELL="${shell}"
              LABEL_SELECTOR="${podLabelSelector}"

              echo "Connecting to $RESOURCE_TYPE \\"$RESOURCE_NAME\\" in namespace \\"$NAMESPACE\\""

              # get all pods for this workload
              PODS=$(kubectl get pods -n "$NAMESPACE" -l "$LABEL_SELECTOR" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")

              if [ -z "$PODS" ]; then
                echo "No pods found"
                exit 1
              fi

              # convert space-separated string to array
              read -ra POD_ARRAY <<< "$PODS"

              if [ \${#POD_ARRAY[@]} -eq 1 ]; then
                # single pod found, connect directly
                SELECTED_POD="\${POD_ARRAY[0]}"
                echo "Found single pod: $SELECTED_POD"
              else
                # multiple pods found, use fzf for selection
                echo "Found \${#POD_ARRAY[@]} pods. Please select one."
                
                SELECTED_POD=$(printf '%s\n' "\${POD_ARRAY[@]}" | fzf --prompt="Select pod: " --height 10 --border --info=inline)
                
                if [ -z "$SELECTED_POD" ]; then
                  echo "No pod selected"
                  exit 1
                fi
                
                echo "Selected pod: $SELECTED_POD"
              fi

              # execute into the selected pod
              exec kubectl exec -it -n "$NAMESPACE" "$SELECTED_POD" -c "$CONTAINER_NAME" -- "$SHELL"
            `.apply(trimIndentation),
          ),
        },

        env: {
          KUBECONFIG: "/kubeconfig",
        },
      },
    })
  }

  /**
   * Creates a terminal with a custom command.
   *
   * @param meta The metadata for the terminal.
   * @param command The command to run in the terminal.
   * @param spec Additional spec options for the terminal.
   */
  createTerminal(
    name: string,
    meta: UnitTerminal["meta"],
    command: InputArray<string>,
    spec?: { env?: DeepInput<TerminalSpec["env"]>; files?: DeepInput<TerminalSpec["files"]> },
  ): Output<UnitTerminal> {
    const containerName = output(this.containers).apply(containers => {
      return containers[0]?.name ?? this.name
    })

    return output({
      name,

      meta: output(this.getTerminalMeta()).apply(currentMeta => ({
        ...currentMeta,
        ...meta,
      })),

      spec: {
        image: images["terminal-kubectl"].image,

        command: output(command).apply(command => [
          "exec",
          "kubectl",
          "exec",
          "-it",
          "-n",
          this.metadata.namespace,
          interpolate`${this.kind.apply(k => k.toLowerCase())}/${this.metadata.name}`,
          "-c",
          containerName,
          "--",
          ...command,
        ]),

        files: {
          "/kubeconfig": fileFromString("kubeconfig", this.cluster.kubeconfig, { isSecret: true }),
          ...spec?.files,
        },

        env: {
          KUBECONFIG: "/kubeconfig",
          ...spec?.env,
        },
      },
    })
  }
}

export abstract class ExposableWorkload extends Workload {
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
    podTemplate: Output<types.output.core.v1.PodTemplateSpec>,
    networkPolicy: Output<NetworkPolicy | undefined>,

    protected readonly _service: Output<Service | undefined>,

    /**
     * The access point routes associated with the workload.
     */
    readonly routes: Output<AccessPointRoute[]>,
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
      podTemplate,
      networkPolicy,
    )
  }

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set optionalService(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set service(_value: never) {}

  /**
   * The service associated with the workload.
   */
  get optionalService(): Output<Service | undefined> {
    return this._service
  }

  /**
   * The service associated with the workload.
   *
   * Will throw an error if the service is not available.
   */
  get service(): Output<Service> {
    return this._service.apply(service => {
      if (!service) {
        throw new Error(`The service of the workload "${this.name}" is not available.`)
      }

      return service
    })
  }

  /**
   * The entity of the workload.
   */
  abstract get entity(): Output<k8s.ExposableWorkload>

  /**
   * The sped of the underlying Kubernetes workload.
   */
  abstract get spec(): Output<
    types.output.apps.v1.DeploymentSpec | types.output.apps.v1.StatefulSetSpec
  >

  /**
   * Creates a generic workload or patches the existing one.
   */
  static createOrPatchGeneric(
    name: string,
    args: GenericExposableWorkloadArgs,
    opts?: CustomResourceOptions,
  ): Output<ExposableWorkload> {
    return output(args).apply(async args => {
      if (args.existing?.type === "deployment") {
        const { Deployment } = await import("./deployment")

        return Deployment.patch(
          name,
          {
            ...deepmerge(args, args.deployment),
            name: args.existing.metadata.name,
            namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
          },
          opts,
        )
      }

      if (args.existing?.type === "stateful-set") {
        const { StatefulSet } = await import("./stateful-set")

        return StatefulSet.patch(
          name,
          {
            ...deepmerge(args, args.statefulSet),
            name: args.existing.metadata.name,
            namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
          },
          opts,
        )
      }

      if (args.type === "Deployment") {
        const { Deployment } = await import("./deployment")

        return Deployment.create(name, deepmerge(args, args.deployment), opts)
      }

      if (args.type === "StatefulSet") {
        const { StatefulSet } = await import("./stateful-set")

        return StatefulSet.create(name, deepmerge(args, args.statefulSet), opts)
      }

      throw new Error(`Unknown workload type: ${args.type as string}`)
    })
  }
}
