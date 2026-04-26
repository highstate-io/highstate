import type { InstanceInput } from "./instance"
import { z } from "zod"

export const componentKindSchema = z.enum(["composite", "unit"])
export type ComponentKind = z.infer<typeof componentKindSchema>

export const runtimeSchema = Symbol("runtimeSchema")
export const kind = Symbol("kind")
export const boundaryInput = Symbol("boundaryInput")

export function inputKey(input: InstanceInput): string {
  return input.path
    ? `${input.instanceId}:${input.output}:${input.path}`
    : `${input.instanceId}:${input.output}`
}
