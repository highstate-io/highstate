import { z } from "zod"

/**
 * Schema for the sourceHash configuration in package.json
 */
export const sourceHashConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("manual"),
    version: z.string(),
  }),
  z.object({
    mode: z.literal("auto"),
  }),
  z.object({
    mode: z.literal("version"),
  }),
  z.object({
    mode: z.literal("none"),
  }),
])

/**
 * Schema for the highstate configuration in package.json
 */
export const highstateConfigSchema = z.object({
  type: z.enum(["source", "library", "worker"]).default("source"),
  sourceHash: z
    .union([sourceHashConfigSchema, z.record(z.string(), sourceHashConfigSchema)])
    .optional(),
})

/**
 * Schema for the highstate manifest file
 */
export const highstateManifestSchema = z.object({
  sourceHashes: z.record(z.string(), z.number()).optional(),
})

export type SourceHashConfig = z.infer<typeof sourceHashConfigSchema>
export type HighstateConfig = z.infer<typeof highstateConfigSchema>
export type HighstateManifest = z.infer<typeof highstateManifestSchema>
