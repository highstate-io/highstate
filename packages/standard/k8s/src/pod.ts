import type { types } from "@pulumi/kubernetes"

export const podSpecDefaults: Partial<types.input.core.v1.PodSpec> = {
  automountServiceAccountToken: false,
}
