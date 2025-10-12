import type { network } from "@highstate/library"
import type { ContainerEnvironment, ContainerVolumeMount, WorkloadVolume } from "../container"
import type { ScopedResourceArgs } from "../shared"
import { parseL34Endpoint } from "@highstate/common"
import { text, trimIndentation } from "@highstate/contract"
import { type InputArray, normalize } from "@highstate/pulumi"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
  type Unwrap,
} from "@pulumi/pulumi"
import { serializeFunction } from "@pulumi/pulumi/runtime/index.js"
import { deepmerge } from "deepmerge-ts"
import { readPackageJSON } from "pkg-types"
import { mapValues, omitBy } from "remeda"
import { ConfigMap } from "../config-map"
import {
  emptyScriptEnvironment,
  functionScriptImages,
  type ResolvedScriptEnvironment,
  type ScriptDistribution,
  type ScriptEnvironment,
} from "./environment"

export type ScriptBundleArgs = ScopedResourceArgs & {
  /**
   * The environment to bundle the scripts from.
   */
  environment?: Input<ScriptEnvironment>

  /**
   * The environments to bundle the scripts from.
   */
  environments?: InputArray<ScriptEnvironment>

  /**
   * The distribution to use for the scripts.
   */
  distribution: ScriptDistribution
}

export class ScriptBundle extends ComponentResource {
  /**
   * The config map containing the scripts.
   */
  readonly configMap: Output<ConfigMap>

  /**
   * The volumes that should be included in the workload.
   */
  readonly volumes: Output<WorkloadVolume[]>

  /**
   * The volume mounts that should be defined in the container.
   */
  readonly volumeMounts: Output<ContainerVolumeMount[]>

  /**
   * The environment variables that should be defined in the container.
   */
  readonly environment: Output<ContainerEnvironment>

  /**
   * The image to use for the scripts.
   */
  readonly image: Output<string>

  /**
   * The distribution to use for the scripts.
   */
  readonly distribution: ScriptDistribution

  /**
   * The list of endpoints that the script is allowed to access.
   */
  readonly allowedEndpoints: Output<network.L34Endpoint[]>

  constructor(name: string, args: ScriptBundleArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:ScriptBundle", name, args, opts)

    const scriptEnvironment = output(args)
      .apply(args => normalize(args.environment, args.environments))
      .apply(args => deepmerge(emptyScriptEnvironment, ...args)) as Output<
      Unwrap<ResolvedScriptEnvironment>
    >

    const hasFunctionScripts = scriptEnvironment.apply(scriptEnvironment => {
      return Object.values(scriptEnvironment.files).some(file => typeof file === "function")
    })

    this.distribution = args.distribution
    this.environment = scriptEnvironment.environment

    this.image = hasFunctionScripts.apply(hasFunctionScripts =>
      output(
        hasFunctionScripts
          ? functionScriptImages[args.distribution]
          : scriptEnvironment[args.distribution].image,
      ),
    )

    this.allowedEndpoints = output({ scriptEnvironment, hasFunctionScripts }).apply(
      ({ scriptEnvironment, hasFunctionScripts }) => {
        const allowedEndpoints = [
          ...scriptEnvironment.allowedEndpoints,
          ...scriptEnvironment[args.distribution].allowedEndpoints,
        ]

        if (hasFunctionScripts) {
          allowedEndpoints.push("tcp://registry.npmjs.org:443")
        }

        return allowedEndpoints.map(parseL34Endpoint)
      },
    )

    this.configMap = output({ scriptEnvironment, args }).apply(({ scriptEnvironment, args }) => {
      return ConfigMap.create(
        name,
        {
          namespace: args.namespace,

          data: createScriptData(this.distribution, scriptEnvironment),
        },
        { ...opts, parent: this },
      )
    })

    this.volumes = output({ hasFunctionScripts, volumes: scriptEnvironment.volumes }).apply(
      ({ hasFunctionScripts, volumes }) => {
        return [
          ...volumes,
          {
            name: this.configMap.metadata.name,

            configMap: {
              name: this.configMap.metadata.name,
              defaultMode: 0o550, // read and execute permissions
            },
          },
          ...(hasFunctionScripts ? [{ name: "node-modules", emptyDir: {} }] : []),
        ]
      },
    )

    this.volumeMounts = output({
      hasFunctionScripts,
      volumeMounts: scriptEnvironment.volumeMounts,
    }).apply(({ hasFunctionScripts, volumeMounts }) => {
      return [
        ...volumeMounts,
        {
          volume: this.configMap,
          mountPath: "/scripts",
        },
        ...(hasFunctionScripts
          ? [{ name: "node-modules", mountPath: "/scripts/node_modules" }]
          : []),
      ]
    })
  }
}

function stripWorkspacePrefix(value: string): string {
  if (value.startsWith("workspace:")) {
    return value.replace("workspace:", "")
  }

  return value
}

async function createScriptData(
  distribution: ScriptDistribution,
  environment: Unwrap<ResolvedScriptEnvironment>,
): Promise<Record<string, string>> {
  const scriptData: Record<string, string> = {}
  const actions: string[] = []

  const distributionEnvironment = environment[distribution]
  const setupScripts = { ...environment.setupScripts }

  let hasFunctionScripts = false

  for (const key in environment.files) {
    if (typeof environment.files[key] === "function") {
      const serialized = await serializeFunction(environment.files[key])

      scriptData[key] = text`
        #!/usr/local/bin/bun
        
        ${serialized.text}

        exports.${serialized.exportName}()
      `

      hasFunctionScripts = true
    } else {
      scriptData[key] = environment.files[key]
    }
  }

  if (hasFunctionScripts) {
    const packageJson = await readPackageJSON()

    packageJson.dependencies = omitBy(
      mapValues(packageJson.dependencies ?? {}, stripWorkspacePrefix),
      (_, key) => key.startsWith("@highstate/"),
    )

    packageJson.devDependencies = omitBy(
      mapValues(packageJson.devDependencies ?? {}, stripWorkspacePrefix),
      (_, key) => key.startsWith("@highstate/"),
    )

    scriptData["package.json"] = JSON.stringify(packageJson, null, 2)

    setupScripts["resolve-dependencies.sh"] = text`
      #!/usr/local/bin/bun
      set -e

      cd /scripts
      bun install --production
    `
  }

  if (distributionEnvironment.preInstallPackages.length > 0) {
    scriptData["pre-install-packages.sh"] = getInstallPackagesScript(
      distribution,
      distributionEnvironment.preInstallPackages,
    )

    actions.push(`
      echo "+ Installing pre-install packages..."
      /scripts/pre-install-packages.sh
      echo "+ Pre-install packages installed successfully"
    `)
  }

  if (Object.keys(distributionEnvironment.preInstallScripts).length > 0) {
    for (const key in distributionEnvironment.preInstallScripts) {
      scriptData[`pre-install-${key}`] = distributionEnvironment.preInstallScripts[key]

      actions.push(`
        echo "+ Running pre-install script '${key}'..."
        /scripts/pre-install-${key}
        echo "+ Pre-install script '${key}'... Done"
      `)
    }
  }

  if (distributionEnvironment.packages.length > 0) {
    scriptData["install-packages.sh"] = getInstallPackagesScript(
      distribution,
      distributionEnvironment.packages,
    )

    actions.push(`
      echo "+ Installing packages..."
      /scripts/install-packages.sh
      echo "+ Packages installed successfully"
    `)
  }

  if (Object.keys(setupScripts).length > 0) {
    for (const key in setupScripts) {
      scriptData[`setup-${key}`] = setupScripts[key]

      actions.push(`
        echo "+ Running setup script '${key}'..."
        /scripts/setup-${key}
        echo "+ Setup script '${key}'... Done"
      `)
    }
  }

  if (Object.keys(environment.cleanupScripts).length > 0) {
    const cleanupActions: string[] = []

    for (const key in environment.cleanupScripts) {
      scriptData[`cleanup-${key}`] = environment.cleanupScripts[key]

      cleanupActions.push(`
        echo "+ Running cleanup script '${key}'..."
        /scripts/cleanup-${key}
        echo "+ Cleanup script '${key}'... Done"
      `)
    }

    actions.push(`
      function cleanup() {
      ${cleanupActions.map(s => s.trim()).join("\n\n")}
      }

      trap cleanup EXIT
      trap cleanup SIGTERM
    `)
  }

  scriptData["entrypoint.sh"] = trimIndentation(`
    #!/bin/sh
    set -e

    if [ -z "$1" ]; then
      echo "Usage: entrypoint.sh <main script> [args...]"
      exit 1
    fi

  ${actions.map(s => s.trim()).join("\n\n")}

    echo "+ Running main script..."
    $@
    echo "+ Main script completed"
  `)

  return scriptData
}

function getInstallPackagesScript(distribution: ScriptDistribution, packages: string[]): string {
  if (distribution === "alpine") {
    return text`
      #!/bin/sh
      set -e

      apk add --no-cache ${packages.join(" ")}
    `
  } else {
    return text`
      #!/bin/sh
      set -e

      apt-get update
      apt-get install -y ${packages.join(" ")}
    `
  }
}
