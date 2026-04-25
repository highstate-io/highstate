import type { k8s, network } from "@highstate/library"
import type { types } from "@pulumi/kubernetes"
import type { DistributedOmit, Except } from "type-fest"
import type { DeploymentArgs } from "./deployment"
import type { JobArgs } from "./job"
import type { StatefulSetArgs } from "./stateful-set"
import {
  AccessPointRoute,
  type AccessPointRouteArgs,
  type GatewayHttpRuleArgs,
  type GatewayRuleArgs,
  mergeEndpoints,
} from "@highstate/common"
import { type TerminalSpec, trimIndentation, type UnitTerminal } from "@highstate/contract"
import {
  type ComponentResourceOptions,
  type DeepInput,
  type InputArray,
  type InputRecord,
  makeFileOutput,
  normalize,
  normalizeInputs,
  toPromise,
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
import { filter, flat, isNonNullish, omit, unique, uniqueBy } from "remeda"
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
import {
  commonExtraArgs,
  getClusterKubeconfigContent,
  images,
  NamespacedResource,
  type ScopedResourceArgs,
  type SelectorLike,
} from "./shared"

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

/**
 * Filters pod template containers for patch operations to include only containers owned by the patch args.
 *
 * This prevents patching containers from existing workload spec that are not declared via workload container args.
 *
 * @param template The merged pod template that will be sent to Kubernetes.
 * @param ownedTemplate The pod template generated from workload container args.
 * @returns The pod template with filtered container lists.
 */
export function filterPatchOwnedContainersInTemplate(
  template: Unwrap<types.input.core.v1.PodTemplateSpec>,
  ownedTemplate: Unwrap<types.input.core.v1.PodTemplateSpec>,
): Unwrap<types.input.core.v1.PodTemplateSpec> {
  const ownedContainerNames = unique(
    (ownedTemplate.spec?.containers ?? []).map(container => container.name).filter(isNonNullish),
  )

  const ownedInitContainerNames = unique(
    (ownedTemplate.spec?.initContainers ?? [])
      .map(container => container.name)
      .filter(isNonNullish),
  )

  const filterByOwnedNames = <TContainer extends { name?: string }>(
    source: TContainer[] | undefined,
    ownedNames: string[],
  ): TContainer[] | undefined => {
    if (!source || source.length === 0 || ownedNames.length === 0) {
      return undefined
    }

    const filtered = source.filter(container =>
      container.name ? ownedNames.includes(container.name) : false,
    )

    return filtered.length > 0 ? filtered : undefined
  }

  const containers = filterByOwnedNames(template.spec?.containers, ownedContainerNames)
  const initContainers = filterByOwnedNames(template.spec?.initContainers, ownedInitContainerNames)

  const {
    containers: _containers,
    initContainers: _initContainers,
    ...restSpec
  } = template.spec ?? {}

  const spec = {
    ...restSpec,
    ...(containers ? { containers } : {}),
    ...(initContainers ? { initContainers } : {}),
  } as Partial<Unwrap<types.input.core.v1.PodSpec>>

  return {
    ...template,
    spec: spec as Unwrap<types.input.core.v1.PodSpec>,
  }
}

type WorkloadHttpGatewayRuleArgs = DistributedOmit<GatewayHttpRuleArgs, "backend" | "backends"> & {
  /**
   * The service port to route to.
   *
   * Can be either a numeric port or a named port from the workload service.
   *
   * If not specified, it first falls back to the servicePort of the route,
   * then to the first port of the workload service.
   */
  servicePort?: Input<number | string>
}

type WorkloadTcpUdpGatewayRuleArgs = DistributedOmit<GatewayRuleArgs, "backend" | "backends"> & {
  /**
   * The service port to route to.
   *
   * Can be either a numeric port or a named port from the workload service.
   *
   * If not specified, it first falls back to the servicePort of the route,
   * then to the first port of the workload service.
   */
  servicePort?: Input<number | string>
}

type WorkloadGatewayRuleArgs = WorkloadHttpGatewayRuleArgs | WorkloadTcpUdpGatewayRuleArgs

export type WorkloadRouteArgs = Except<AccessPointRouteArgs, "backend" | "backends" | "rules"> & {
  /**
   * The service port to route to by default.
   *
   * Can be either a numeric port or a named port from the workload service.
   *
   * Can be overridden by `rules.*.servicePort`.
   * If omitted, the first port of the workload service is used.
   */
  servicePort?: Input<number | string>
} & (
    | {
        type: "http"

        /**
         * The path to match for the `default` rule of the listener.
         */
        path?: Input<string>

        /**
         * The paths to match for the `default` rule of the listener.
         */
        paths?: Input<string[]>

        /**
         * The rules of the route.
         */
        rules?: InputRecord<WorkloadHttpGatewayRuleArgs>
      }
    | {
        type: "tcp" | "udp"

        /**
         * The rules of the route.
         */
        rules?: InputRecord<WorkloadTcpUdpGatewayRuleArgs>
      }
  )

export type WorkloadServiceArgs = WorkloadArgs & {
  service?: Input<Omit<ServiceArgs, "cluster" | "namespace">>

  /**
   * The configuration for the access point route to create.
   */
  route?: Input<WorkloadRouteArgs>

  /**
   * The configuration for the access point routes to create.
   */
  routes?: InputArray<WorkloadRouteArgs>

  /**
   * The existing workload to patch.
   */
  existing?: Input<k8s.Workload>
}

export const workloadServiceExtraArgs = [
  ...workloadExtraArgs,
  "service",
  "route",
  "routes",
] as const

export type WorkloadType = "Deployment" | "StatefulSet" | "Job" | "CronJob"

export type GenericWorkloadArgs = Omit<WorkloadServiceArgs, "existing"> & {
  /**
   * The type of workload to create.
   *
   * Will be ignored if the `existing` argument is provided.
   */
  defaultType: WorkloadType

  /**
   * The existing workload to patch.
   */
  existing: Input<k8s.Workload | undefined>

  /**
   * The args specific to the "Deployment" workload type.
   *
   * Will be ignored for other workload types.
   */
  deployment?: Input<Omit<DeploymentArgs, "name" | "namespace">>

  /**
   * The args specific to the "StatefulSet" workload type.
   *
   * Will be ignored for other workload types.
   */
  statefulSet?: Input<Omit<StatefulSetArgs, "name" | "namespace">>

  /**
   * The args specific to the "Job" workload type.
   *
   * Will be ignored for other workload types.
   */
  job?: Input<JobArgs>

  /**
   * The args specific to the "CronJob" workload type.
   *
   * Will be ignored for other workload types.
   */
  cronJob?: Input<JobArgs>
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
          [`highstate.io/dependency-hash-${dependencyHash.slice(32)}`]: "1",
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

export function getWorkloadServiceComponents(
  name: string,
  args: WorkloadServiceArgs,
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
  }).apply(async ({ routesArgs, service, namespace }) => {
    if (!routesArgs.length || !service) {
      return []
    }

    if (args.existing) {
      return []
    }

    const serviceEndpoints = await toPromise(service.endpoints)
    const servicePorts = await toPromise(service.spec.ports)

    const resolveServiceEndpoints = async (
      servicePort: Input<number | string> | undefined,
      routeName: string,
    ): Promise<network.L4Endpoint[]> => {
      if (serviceEndpoints.length === 0) {
        throw new Error(`No endpoints found for workload service in route "${routeName}"`)
      }

      let resolvedServicePort: number | undefined

      if (servicePort != null) {
        const requestedServicePort = await toPromise(servicePort)

        if (typeof requestedServicePort === "string") {
          const namedPort = servicePorts?.find(port => port.name === requestedServicePort)

          if (!namedPort) {
            throw new Error(
              `Named port "${requestedServicePort}" not found for workload service in route "${routeName}"`,
            )
          }

          resolvedServicePort = namedPort.port
        } else {
          resolvedServicePort = requestedServicePort
        }
      } else {
        resolvedServicePort = serviceEndpoints[0]?.port
      }

      if (resolvedServicePort == null) {
        throw new Error(
          `Unable to resolve service port for workload service in route "${routeName}"`,
        )
      }

      const filteredEndpoints = serviceEndpoints.filter(
        endpoint => endpoint.port === resolvedServicePort,
      )

      if (filteredEndpoints.length === 0) {
        throw new Error(
          `No endpoints with port ${resolvedServicePort} found for workload service in route "${routeName}"`,
        )
      }

      return filteredEndpoints
    }

    return await Promise.all(
      routesArgs.map(async (routeArgs, index) => {
        const routeName = `${name}.${index}`
        const routeRules = (await toPromise(routeArgs.rules)) as
          | Record<string, WorkloadGatewayRuleArgs>
          | undefined
        const routeRuleValues = Object.values(routeRules ?? {})
        const needsDefaultBackend =
          routeRuleValues.length === 0 || routeRuleValues.some(rule => rule.servicePort == null)

        const defaultServiceEndpoints = needsDefaultBackend
          ? await resolveServiceEndpoints(routeArgs.servicePort, routeName)
          : undefined

        const resolvedRules = routeRules
          ? await Promise.all(
              Object.entries(routeRules).map(async ([ruleName, rule]) => {
                const ruleServiceEndpoints = await resolveServiceEndpoints(
                  rule.servicePort ?? routeArgs.servicePort,
                  `${routeName}:${ruleName}`,
                )

                return [
                  ruleName,
                  {
                    ...omit(rule, ["servicePort"]),
                    backend: {
                      endpoints: ruleServiceEndpoints,
                    },
                  },
                ] as const
              }),
            )
          : undefined

        const resolvedRulesInput = resolvedRules
          ? (Object.fromEntries(resolvedRules) as unknown as InputRecord<GatewayRuleArgs>)
          : undefined

        return new AccessPointRoute(routeName, {
          ...omit(routeArgs, ["servicePort", "rules"]),
          ...(defaultServiceEndpoints
            ? {
                backend: {
                  endpoints: defaultServiceEndpoints,
                },
              }
            : {}),
          rules: resolvedRulesInput,
          metadata: {
            ...(routeArgs.metadata ?? {}),
            "k8s.namespace": namespace,
          },
        })
      }),
    )
  })

  return { labels, containers, volumes, podSpec, podTemplate, networkPolicy, service, routes }
}

export abstract class Workload extends NamespacedResource {
  protected constructor(
    type: string,
    protected readonly name: string,
    args: Inputs,
    opts: ComponentResourceOptions | undefined,

    metadata: Output<types.output.meta.v1.ObjectMeta>,
    namespace: Output<Namespace>,

    protected readonly terminalArgs: Output<Unwrap<WorkloadTerminalArgs>>,
    protected readonly containers: Output<Container[]>,

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

    protected readonly _service: Output<Service | undefined> = output(undefined),

    /**
     * The access point routes associated with the workload.
     */
    readonly routes: Output<AccessPointRoute[]> = output([]),
  ) {
    super(type, name, args, opts, metadata, namespace)
  }

  abstract get entity(): Output<k8s.Workload>

  protected abstract get templateMetadata(): Output<types.output.meta.v1.ObjectMeta>

  protected abstract getTerminalMeta(): Output<UnitTerminal["meta"]>

  private set terminal(_value: never) {}

  private set logsTerminal(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set terminals(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set optionalService(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set service(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set selector(_value: never) {}

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
   * The merged and deduplicated L3 endpoints of all routes.
   */
  get endpoints(): Output<network.L3Endpoint[]> {
    return this.routes.apply(routes =>
      output(routes.map(route => route.route.endpoints))
        .apply(endpoints => flat(endpoints))
        .apply(mergeEndpoints),
    )
  }

  /**
   * The selector matching pods created from this workload's template labels.
   */
  get selector(): Output<SelectorLike> {
    return this.podTemplate.apply(template => ({
      matchLabels: template.metadata?.labels,
    }))
  }

  /**
   * The instance terminal to interact with the workload's pods.
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
          "/kubeconfig": makeFileOutput({
            name: "kubeconfig",
            content: getClusterKubeconfigContent(this.cluster),
            isSecret: true,
          }),

          "/welcome.sh": makeFileOutput({
            name: "welcome.sh",
            content: interpolate`
              #!/bin/bash
              set -euo pipefail

              NAMESPACE="${this.metadata.namespace}"
              RESOURCE_TYPE="${this.kind.toLowerCase()}"
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
          }),
        },

        env: {
          KUBECONFIG: "/kubeconfig",
        },
      },
    })
  }

  /**
   * The instance terminal to view the workload's logs.
   */
  get logsTerminal(): Output<UnitTerminal> {
    const containerName = this.podTemplate.spec.containers.apply(containers => containers[0].name)

    const podLabelSelector = this.templateMetadata
      .apply(meta => meta.labels ?? {})
      .apply(labels =>
        Object.entries(labels)
          .map(([key, value]) => `${key}=${value}`)
          .join(","),
      )

    return output({
      name: interpolate`${this.metadata.name}.logs`,

      meta: output(this.getTerminalMeta()).apply(meta => ({
        ...meta,
        title: `${meta.title} Logs`,
        globalTitle: `${meta.globalTitle} | Logs`,
        description: `The logs of ${meta.title.toLowerCase()}.`,
      })),

      spec: {
        image: images["terminal-kubectl"].image,
        command: ["bash", "/welcome.sh"],

        files: {
          "/kubeconfig": makeFileOutput({
            name: "kubeconfig",
            content: getClusterKubeconfigContent(this.cluster),
            isSecret: true,
          }),

          "/welcome.sh": makeFileOutput({
            name: "welcome.sh",
            content: interpolate`
              #!/bin/bash
              set -euo pipefail

              NAMESPACE="${this.metadata.namespace}"
              RESOURCE_TYPE="${this.kind.toLowerCase()}"
              RESOURCE_NAME="${this.metadata.name}"
              CONTAINER_NAME="${containerName}"
              LABEL_SELECTOR="${podLabelSelector}"

              echo "Connecting to logs of $RESOURCE_TYPE \"$RESOURCE_NAME\" in namespace \"$NAMESPACE\""

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

              # stream logs for the selected pod
              exec kubectl logs -f -n "$NAMESPACE" "$SELECTED_POD" -c "$CONTAINER_NAME"
            `.apply(trimIndentation),
          }),
        },

        env: {
          KUBECONFIG: "/kubeconfig",
        },
      },
    })
  }

  /**
   * The instance terminals to interact with the workload's pods and view its logs.
   */
  get terminals(): Output<UnitTerminal>[] {
    return [this.logsTerminal, this.terminal]
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
    const containerName = this.podTemplate.spec.containers.apply(containers => containers[0].name)

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
          interpolate`${this.kind.toLowerCase()}/${this.metadata.name}`,
          "-c",
          containerName,
          "--",
          ...command,
        ]),

        files: {
          "/kubeconfig": makeFileOutput({
            name: "kubeconfig",
            content: getClusterKubeconfigContent(this.cluster),
            isSecret: true,
          }),
          ...spec?.files,
        },

        env: {
          KUBECONFIG: "/kubeconfig",
          ...spec?.env,
        },
      },
    })
  }

  /**
   * Creates a generic workload or patches the existing one.
   */
  static createOrPatchGeneric(
    name: string,
    args: GenericWorkloadArgs,
    opts?: CustomResourceOptions,
  ): Output<Workload> {
    return output(args).apply(async args => {
      if (args.existing?.kind === "Deployment") {
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

      if (args.existing?.kind === "StatefulSet") {
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

      if (args.existing?.kind === "Job") {
        const { Job } = await import("./job")

        return Job.patch(
          name,
          {
            ...deepmerge(args, args.job),
            name: args.existing.metadata.name,
            namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
          },
          opts,
        )
      }

      if (args.existing?.kind === "CronJob") {
        const { CronJob } = await import("./cron-job")

        return CronJob.patch(
          name,
          {
            ...deepmerge(args, args.cronJob),
            name: args.existing.metadata.name,
            namespace: Namespace.forResourceAsync(args.existing, output(args.namespace).cluster),
          },
          opts,
        )
      }

      if (args.defaultType === "Deployment") {
        const { Deployment } = await import("./deployment")

        const deploymentArgs = deepmerge(
          omit(args, ["defaultType", "existing", "deployment", "statefulSet", "job", "cronJob"]),
          args.deployment ?? {},
        ) as DeploymentArgs

        return Deployment.create(name, deploymentArgs, opts)
      }

      if (args.defaultType === "StatefulSet") {
        const { StatefulSet } = await import("./stateful-set")

        const statefulSetArgs = deepmerge(
          omit(args, ["defaultType", "existing", "deployment", "statefulSet", "job", "cronJob"]),
          args.statefulSet ?? {},
        ) as StatefulSetArgs

        return StatefulSet.create(name, statefulSetArgs, opts)
      }

      if (args.defaultType === "Job") {
        const { Job } = await import("./job")

        return Job.create(name, deepmerge(args, args.job), opts)
      }

      if (args.defaultType === "CronJob") {
        const { CronJob } = await import("./cron-job")

        return CronJob.create(name, deepmerge(args, args.cronJob), opts)
      }

      throw new Error(`Unknown workload type: ${args.defaultType as string}`)
    })
  }
}
