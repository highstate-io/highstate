import type { Container } from "../container"
import type { ScriptBundle } from "./bundle"
import { type Input, type Output, output } from "@pulumi/pulumi"
import { merge } from "remeda"

export type ScriptContainer = Container & {
  /**
   * The script bundle to use.
   */
  bundle: Input<ScriptBundle>

  /**
   * The name of the main script to run.
   * The script must be available in the bundle.
   */
  main: Input<string>
}

/**
 * Creates a spec for a container that runs a script.
 * This spec can be used to create a complete workload or an init container.
 *
 * @param options The options to create the container spec.
 * @returns The container spec.
 */
export function createScriptContainer(options: ScriptContainer): Output<Container> {
  const bundle = output(options.bundle)

  return output({
    options,
    image: bundle.image,
    volumeMounts: bundle.volumeMounts,
    volumes: bundle.volumes,
    environment: bundle.environment,
    allowedEndpoints: bundle.allowedEndpoints,
  }).apply(({ options, image, volumeMounts, volumes, environment, allowedEndpoints }) => {
    return {
      image,
      command: ["/scripts/entrypoint.sh", `/scripts/${options.main}`],

      ...options,

      volumeMounts: [...volumeMounts, ...(options.volumeMounts ?? [])],
      volumes: [...volumes, ...(options.volumes ?? [])],
      environment: merge(environment, options.environment),
      allowedEndpoints: [...allowedEndpoints, ...(options.allowedEndpoints ?? [])],
    } as Container
  })
}
