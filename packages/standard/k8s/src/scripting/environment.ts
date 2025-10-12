import type { InputL34Endpoint } from "@highstate/common"
import type { Input, InputArray, InputRecord } from "@highstate/pulumi"
import type { ContainerEnvironment, ContainerVolumeMount, WorkloadVolume } from "../container"

export type ScriptDistribution = "alpine" | "ubuntu"

export type DistributionEnvironment = {
  /**
   * The image that should be used for the distribution.
   */
  image?: Input<string>

  /**
   * The utility packages that should be installed before running "preInstallScripts".
   *
   * Useful for installing tools like `curl` to install additional repositories.
   */
  preInstallPackages?: InputArray<string>

  /**
   * The pre-install scripts that should be run before installing packages.
   * Typically, these scripts are used to install additional repositories.
   */
  preInstallScripts?: InputRecord<string>

  /**
   * The packages that are available in the environment.
   */
  packages?: InputArray<string>

  /**
   * The endpoint which the script is allowed to access scoped to the distribution.
   *
   * Typically, this is used to allow access to the package manager.
   *
   * Will be used to generate a network policy.
   */
  allowedEndpoints?: InputArray<InputL34Endpoint>
}

export type ScriptProgram = () => unknown

export type ScriptEnvironment = {
  [distribution in ScriptDistribution]?: DistributionEnvironment
} & {
  /**
   * The setup scripts that should be run before the script.
   */
  setupScripts?: InputRecord<string>

  /**
   * The cleanup scripts that should be run after the script.
   */
  cleanupScripts?: InputRecord<string>

  /**
   * The arbitrary files available in the environment including scripts.
   */
  files?: InputRecord<string | ScriptProgram>

  /**
   * The volumes that should be defined in the environment.
   */
  volumes?: InputArray<WorkloadVolume>

  /**
   * The volume mounts that should be defined in the environment.
   */
  volumeMounts?: InputArray<ContainerVolumeMount>

  /**
   * The environment variables that should be defined in the environment.
   */
  environment?: Input<ContainerEnvironment>

  /**
   * The endpoint which the script is allowed to access.
   *
   * Will be used to generate a network policy.
   */
  allowedEndpoints?: InputArray<InputL34Endpoint>
}

export type ResolvedScriptEnvironment = Omit<Required<ScriptEnvironment>, ScriptDistribution> & {
  [distribution in ScriptDistribution]: Required<DistributionEnvironment>
}

const emptyDistributionEnvironment = {
  preInstallPackages: [],
  preInstallScripts: {},
  packages: [],
}

export const emptyScriptEnvironment: ResolvedScriptEnvironment = {
  alpine: {
    ...emptyDistributionEnvironment,
    image: "alpine@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c",
    allowedEndpoints: [
      //
      "tcp://dl-cdn.alpinelinux.org:443",
      "tcp://dl-cdn.alpinelinux.org:80",
    ],
  },

  ubuntu: {
    ...emptyDistributionEnvironment,
    image: "ubuntu@sha256:72297848456d5d37d1262630108ab308d3e9ec7ed1c3286a32fe09856619a782",
    allowedEndpoints: [
      //
      "tcp://archive.ubuntu.com:80",
      "tcp://archive.ubuntu.com:443",
      "tcp://security.ubuntu.com:80",
      "tcp://security.ubuntu.com:443",
    ],
  },

  setupScripts: {},
  cleanupScripts: {},
  files: {},
  volumes: [],
  volumeMounts: [],
  environment: {},
  allowedEndpoints: [],
}

export const functionScriptImages: Record<ScriptDistribution, string> = {
  alpine: "oven/bun@sha256:6b14922b0885c3890cdb0b396090af1da486ba941df5ee94391eef64f7113c61",
  ubuntu: "oven/bun@sha256:66b431441dc4c36d7e8164bfc61e6348ec1d7ce2862fc3a29f5dc9856e8205e4",
}
