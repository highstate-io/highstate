import { parse } from "yaml"
import { z } from "zod"
import {
  fileMetaSchema,
  HighstateSignature,
  instanceIdSchema,
  instanceInputSchema,
  yamlValueSchema,
} from "./instance"
import { commonObjectMetaSchema } from "./meta"
import { triggerInvocationSchema } from "./trigger"

export const unitInputSourceSchema = z.object({
  ...instanceInputSchema.shape,
})

export type UnitInputSource = z.infer<typeof unitInputSourceSchema>

export const unitInputValueSchema = z.object({
  /**
   * Inline resolved value passed to the unit.
   *
   * The backend is responsible for resolving the correct entity snapshot value
   * and applying any inclusion transformations.
   */
  value: z.unknown(),

  /**
   * Optional provenance of the value.
   */
  source: unitInputSourceSchema.optional(),
})

export type UnitInputValue = z.infer<typeof unitInputValueSchema>

export const unitConfigSchema = z.object({
  /**
   * The ID of the instance.
   */
  instanceId: z.string(),

  /**
   * The record of argument values for the unit.
   */
  args: z.record(z.string(), z.unknown()),

  /**
   * The record of input references for the unit.
   */
  inputs: z.record(z.string(), unitInputValueSchema.array()),

  /**
   * The list of triggers that have been invoked for this unit.
   */
  invokedTriggers: triggerInvocationSchema.array(),

  /**
   * The list of secret names that exists and provided to the unit.
   */
  secretNames: z.string().array(),

  /**
   * The base path for imports.
   * Used to resolve dynamic dependencies in strict environments (like in pnpm node_modules isolation).
   */
  importBasePath: z.string(),
})

export type UnitConfig = z.infer<typeof unitConfigSchema>

const yamlResultCache = new WeakMap<object, unknown>()

/**
 * Parses an argument value which can be wrapped in a YAML structure.
 *
 * @param value The value to parse.
 */
export function parseArgumentValue(value: unknown): unknown {
  const yamlResult = yamlValueSchema.safeParse(value)
  if (!yamlResult.success) {
    return value
  }

  const existingResult = yamlResultCache.get(value as object)
  if (existingResult !== undefined) {
    return existingResult
  }

  const result = parse(yamlResult.data.value) as unknown
  yamlResultCache.set(value as object, result)
  return result
}

export enum HighstateConfigKey {
  Config = "highstate",
  Secrets = "highstate.secrets",
}

export const unitArtifactId = Symbol("unitArtifactId")

export const unitArtifactSchema = z.object({
  [HighstateSignature.Artifact]: z.literal(true),
  // only for internal use
  [unitArtifactId]: z.string().optional(),
  hash: z.string(),
  meta: commonObjectMetaSchema.optional(),
})

export const fileContentSchema = z.union([
  z.object({
    type: z.literal("embedded"),

    /**
     * Whether the content is binary or not.
     *
     * If true, the `value` will be a base64 encoded string.
     */
    isBinary: z.boolean().optional(),

    /**
     * The content of the file.
     *
     * If `isBinary` is true, this will be a base64 encoded string.
     */
    value: z.string(),
  }),
  z.object({
    type: z.literal("artifact"),
    ...unitArtifactSchema.shape,
  }),
])

export const fileSchema = z.object({
  meta: fileMetaSchema,
  content: fileContentSchema,
})

export type FileMeta = z.infer<typeof fileMetaSchema>
export type FileContent = z.infer<typeof fileContentSchema>
export type UnitArtifact = z.infer<typeof unitArtifactSchema>
export type File = z.infer<typeof fileSchema>
