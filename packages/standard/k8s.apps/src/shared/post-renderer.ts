import type { types } from "@pulumi/kubernetes"
import type { HelmResourceProcessorFeature } from "../scripts/process-helm-resources"

export function processHelmResourcesPostRenderer(
  ...features: HelmResourceProcessorFeature[]
): types.input.helm.v4.PostRenderer {
  return {
    command: "bun",
    args: ["../scripts/process-helm-resources.js", ...features],
  }
}
