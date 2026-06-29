import { z } from "zod"
import { unitConfigSchema } from "./pulumi"

export const runtimeConfigGetInputSchema = z.void()

export const runtimeConfigGetOutputSchema = unitConfigSchema

export const runtimeResultSubmitInputSchema = z.record(z.string(), z.unknown())

export const runtimeResultSubmitOutputSchema = z.object({})

export const runtimeSidecarFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  secret: z.boolean().default(false),
  mode: z.number().int().optional(),
})

export const runtimeSidecarPortSchema = z.object({
  name: z.string(),
  containerPort: z.number().int().positive().max(65535),
  protocol: z.literal("tcp").default("tcp"),
})

export const runtimeSidecarReadinessSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tcp"),
    port: z.string(),
    timeoutSeconds: z.number().int().positive().default(30),
  }),
  z.object({
    type: z.literal("http"),
    port: z.string(),
    path: z.string(),
    statuses: z.number().int().positive().array().default([200]),
    timeoutSeconds: z.number().int().positive().default(30),
  }),
  z.object({
    type: z.literal("log"),
    pattern: z.string(),
    timeoutSeconds: z.number().int().positive().default(30),
  }),
])

export const runtimeSidecarStartInputSchema = z.object({
  identity: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
  image: z.string(),
  command: z.string().array().optional(),
  args: z.string().array().default([]),
  env: z.record(z.string(), z.string()).default({}),
  files: runtimeSidecarFileSchema.array().default([]),
  ports: runtimeSidecarPortSchema.array().default([]),
  readiness: runtimeSidecarReadinessSchema.optional(),
})

export const runtimeSidecarStartOutputSchema = z.object({
  id: z.string(),
  host: z.string(),
  ports: z.record(
    z.string(),
    z.object({
      host: z.string(),
      port: z.number().int().positive().max(65535),
    }),
  ),
})

export type RuntimeConfigGetInput = z.infer<typeof runtimeConfigGetInputSchema>
export type RuntimeConfigGetOutput = z.infer<typeof runtimeConfigGetOutputSchema>
export type RuntimeResultSubmitInput = z.infer<typeof runtimeResultSubmitInputSchema>
export type RuntimeResultSubmitOutput = z.infer<typeof runtimeResultSubmitOutputSchema>
export type RuntimeSidecarReadiness = z.infer<typeof runtimeSidecarReadinessSchema>
export type RuntimeSidecarStartInput = z.infer<typeof runtimeSidecarStartInputSchema>
export type RuntimeSidecarStartOutput = z.infer<typeof runtimeSidecarStartOutputSchema>
