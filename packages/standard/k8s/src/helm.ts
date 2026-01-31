import type { UnitTerminal } from "@highstate/contract"
import type { Namespace } from "./namespace"
import type { Workload, WorkloadTerminalArgs } from "./workload"
import { mkdir, readFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import { AccessPointRoute, type AccessPointRouteArgs } from "@highstate/common"
import {
  type InputArray,
  type InputRecord,
  normalize,
  normalizeInputs,
  toPromise,
} from "@highstate/pulumi"
import { local } from "@pulumi/command"
import { apps, core, helm, type types } from "@pulumi/kubernetes"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
} from "@pulumi/pulumi"
import { sha256 } from "crypto-hash"
import { glob } from "glob"
import spawn from "nano-spawn"
import { isNonNullish, omit } from "remeda"
import { Deployment } from "./deployment"
import { NetworkPolicy, type NetworkPolicyArgs } from "./network-policy"
import { createServiceSpec, Service, type ServiceArgs } from "./service"
import { getNamespaceName, getProvider, type NamespaceLike } from "./shared"
import { StatefulSet } from "./stateful-set"

export type ChartArgs = Omit<
  helm.v4.ChartArgs,
  "chart" | "version" | "repositoryOpts" | "namespace"
> & {
  /**
   * The namespace to deploy the chart into.
   */
  namespace: Input<Namespace>

  /**
   * The custom name of the primary service exposed by the chart.
   *
   * By default, it is the same as the chart name.
   */
  serviceName?: string

  /**
   * The extra args to pass to the main service of the chart.
   *
   * Will be patched via transformations.
   */
  service?: Partial<ServiceArgs>

  /**
   * The manifest of the chart to resolve.
   */
  chart: ChartManifest

  /**
   * The args for the terminal to use.
   *
   * Will be applied to all workloads created by the chart.
   */
  terminal?: Input<WorkloadTerminalArgs>

  /**
   * The configuration for the access point route to create.
   */
  route?: Input<Omit<AccessPointRouteArgs, "endpoints" | "customData">>

  /**
   * The configuration for the access point routes to create.
   */
  routes?: InputArray<Omit<AccessPointRouteArgs, "endpoints" | "customData">>

  /**
   * The network policy to apply to the chart.
   */
  networkPolicy?: Input<Omit<NetworkPolicyArgs, "selector" | "cluster" | "namespace">>

  /**
   * The network policies to apply to the chart.
   */
  networkPolicies?: Input<NetworkPolicyArgs[]>
}

export class Chart extends ComponentResource {
  /**
   * The underlying Helm chart.
   */
  public readonly chart: Output<helm.v4.Chart>

  /**
   * The access point routes created for the chart.
   */
  public readonly routes: Output<AccessPointRoute[]>

  /**
   * The network policies applied to the chart.
   */
  public readonly networkPolicies: Output<NetworkPolicy[]>

  /**
   * All workloads created by the chart.
   */
  public readonly workloads: Output<Workload[]>

  constructor(
    private readonly name: string,
    private readonly args: ChartArgs,
    private readonly opts?: ComponentResourceOptions,
  ) {
    super("highstate:k8s:Chart", name, args, opts)

    const namespace = output(args.namespace).apply(namespace =>
      output(namespace ? getNamespaceName(namespace) : "default"),
    )

    this.chart = output(args.namespace).cluster.apply(cluster => {
      return new helm.v4.Chart(
        name,
        omit(
          {
            ...args,
            chart: resolveHelmChart(args.chart),
            namespace,
          },
          ["route", "routes"],
        ),
        {
          ...opts,
          parent: this,
          provider: getProvider(cluster),

          transforms: [
            ...(opts?.transforms ?? []),

            async resourceArgs => {
              const namespace = await toPromise(output(args.namespace).metadata.name)

              const serviceName = args.serviceName ?? name
              const expectedName = `${name}:${namespace}/${serviceName}`

              if (
                resourceArgs.type === "kubernetes:core/v1:Service" &&
                resourceArgs.name === expectedName
              ) {
                const spec = await toPromise(
                  resourceArgs.props.spec as types.input.core.v1.ServiceSpec,
                )

                const serviceSpec = await toPromise(createServiceSpec(args.service ?? {}, cluster))

                return {
                  props: {
                    ...resourceArgs.props,
                    spec: {
                      ...spec,
                      ...omit(serviceSpec, ["ports"]),
                    },
                  },
                  opts: resourceArgs.opts,
                }
              }

              return undefined
            },
          ],
        },
      )
    })

    this.routes = output(normalizeInputs(args.route, args.routes)).apply(async routes => {
      if (routes.length === 0) {
        return []
      }

      return await Promise.all(
        routes.map(async route => {
          return new AccessPointRoute(
            name,
            {
              ...route,

              endpoints: this.service.endpoints,

              // pass the native data to the route to allow implementation to use it
              gatewayNativeData: await toPromise(this.service),
              tlsCertificateNativeData: await toPromise(args.namespace),
            },
            { ...opts, parent: this },
          )
        }),
      )
    })

    this.networkPolicies = output(args).apply(args => {
      const policies = normalize(args.networkPolicy, args.networkPolicies)

      return output(
        policies.map(policy => {
          return new NetworkPolicy(
            name,
            {
              ...policy,
              namespace: args.namespace,
              description: `Network policy for Helm chart "${name}"`,
            },
            { ...opts, parent: this },
          )
        }),
      )
    })

    this.workloads = output(this.chart).apply(chart => {
      return output(
        chart.resources.apply(resources => {
          return resources
            .map(resource => {
              if (apps.v1.Deployment.isInstance(resource)) {
                return resource.metadata.name.apply(name => {
                  return Deployment.wrap(
                    name,
                    { namespace: args.namespace, deployment: resource, terminal: args.terminal },
                    this.opts,
                  )
                })
              }

              if (apps.v1.StatefulSet.isInstance(resource)) {
                return resource.metadata.name.apply(name => {
                  return StatefulSet.wrap(
                    name,
                    {
                      namespace: args.namespace,
                      statefulSet: resource,
                      service: this.getServiceOutput(name),
                      terminal: args.terminal,
                    },
                    this.opts,
                  )
                })
              }

              return undefined
            })
            .filter(isNonNullish)
        }),
      )
    })
  }

  private set service(_value: never) {}

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: for pulumi which for some reason tries to copy all properties
  private set terminals(_value: never) {}

  get service(): Output<Service> {
    return this.getServiceOutput(undefined)
  }

  get terminals(): Output<UnitTerminal[]> {
    return this.workloads.apply(workloads => output(workloads.map(workload => workload.terminal)))
  }

  private readonly services = new Map<string, Service>()

  getServiceOutput(name: string | undefined): Output<Service> {
    return output({ args: this.args, chart: this.chart }).apply(({ args, chart }) => {
      const resolvedName = name ?? args.serviceName ?? this.name
      const existingService = this.services.get(resolvedName)

      if (existingService) {
        return existingService
      }

      const service = getChartServiceOutput(chart, resolvedName)

      const wrappedService = Service.wrap(
        resolvedName,
        { namespace: args.namespace, service },
        { ...this.opts, parent: this },
      )

      this.services.set(resolvedName, wrappedService)
      return wrappedService
    })
  }

  getService(name?: string): Promise<Service> {
    return toPromise(this.getServiceOutput(name))
  }
}

export type RenderedChartArgs = {
  /**
   * The namespace to deploy the chart into.
   */
  namespace?: Input<NamespaceLike>

  /**
   * The manifest of the chart to resolve.
   */
  chart: ChartManifest

  /**
   * The values to pass to the chart.
   */
  values?: InputRecord<string>
}

export class RenderedChart extends ComponentResource {
  /**
   * The rendered manifest of the Helm chart.
   */
  public readonly manifest: Output<string>

  /**
   * The underlying command used to render the chart.
   */
  public readonly command: Output<local.Command>

  constructor(name: string, args: RenderedChartArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:RenderedChart", name, args, opts)

    this.command = output(args).apply(args => {
      const values = args.values
        ? Object.entries(args.values).flatMap(([key, value]) => ["--set", `${key}="${value}"`])
        : []

      return new local.Command(
        name,
        {
          create: output([
            "helm",
            "template",
            resolveHelmChart(args.chart),

            ...(args.namespace ? ["--namespace", getNamespaceName(args.namespace)] : []),

            ...values,
          ]).apply(command => command.join(" ")),

          logging: "stderr",
        },
        { parent: this, ...opts },
      )
    })

    this.manifest = this.command.stdout

    this.registerOutputs({ manifest: this.manifest, command: this.command })
  }
}

export type ChartManifest = {
  repo: string
  name: string
  version: string
  sha256: string
}

/**
 * Downloads or reuses the Helm chart according to the charts.json file.
 * Returns the full path to the chart's .tgz file.
 *
 * @param manifest The manifest of the Helm chart.
 */
export async function resolveHelmChart(manifest: ChartManifest): Promise<string> {
  if (!process.env.HIGHSTATE_CACHE_DIR) {
    throw new Error("Environment variable HIGHSTATE_CACHE_DIR is not set")
  }

  const chartsDir = resolve(process.env.HIGHSTATE_CACHE_DIR, "charts")
  await mkdir(chartsDir, { recursive: true })

  const globPattern = `${manifest.name}-*.tgz`
  const targetFileName = `${manifest.name}-${manifest.version}.tgz`

  // find all matching files
  const files = await glob(globPattern, { cwd: chartsDir })

  if (files.includes(targetFileName)) {
    return resolve(chartsDir, targetFileName)
  }

  // delete old versions
  for (const file of files) {
    await unlink(resolve(chartsDir, file))
  }

  // download the chart
  const isOci = manifest.repo.startsWith("oci://")
  const chartRef = isOci ? `${manifest.repo.replace(/\/$/, "")}/${manifest.name}` : manifest.name

  const pullArgs = ["pull", chartRef, "--version", manifest.version, "--destination", chartsDir]

  if (!isOci) {
    pullArgs.push("--repo", manifest.repo)
  }

  await spawn("helm", pullArgs)

  // check the SHA256
  const content = await readFile(resolve(chartsDir, targetFileName))
  const actualSha256 = await sha256(content)

  if (actualSha256 !== manifest.sha256) {
    throw new Error(`SHA256 mismatch for chart '${manifest.name}'`)
  }

  return resolve(chartsDir, targetFileName)
}

/**
 * Extracts the service with the given name from the chart resources.
 * Throws an error if the service is not found.
 *
 * @param chart The Helm chart.
 * @param name The name of the service.
 */
export function getChartServiceOutput(chart: helm.v4.Chart, name: string): Output<core.v1.Service> {
  const services = chart.resources.apply(resources => {
    return resources
      .filter(r => core.v1.Service.isInstance(r))
      .map(service => ({ name: service.metadata.name, service }))
  })

  return output(services).apply(services => {
    const service = services.find(s => s.name === name)?.service

    if (!service) {
      throw new Error(`Service with name '${name}' not found in the chart resources`)
    }

    return service
  })
}

/**
 * Extracts the service with the given name from the chart resources.
 * Throws an error if the service is not found.
 *
 * @param chart The Helm chart.
 * @param name The name of the service.
 */
export function getChartService(chart: helm.v4.Chart, name: string): Promise<core.v1.Service> {
  return toPromise(getChartServiceOutput(chart, name))
}
