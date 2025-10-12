import type { ServiceAccount, Terminal, TerminalSession, TerminalStatus } from "../../../database"
import {
  commonObjectMetaSchema,
  globalCommonObjectMetaSchema,
  serviceAccountMetaSchema,
  terminalSpecSchema,
} from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

export const terminalStatusSchema = z.enum([
  "active",
  "unavailable",
]) satisfies z.ZodType<TerminalStatus>

export const terminalSessionOutputSchema = z.object({
  id: z.cuid2(),
  terminalId: z.cuid2(),
  meta: globalCommonObjectMetaSchema,
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
})

export type TerminalSessionOutput = z.infer<typeof terminalSessionOutputSchema>

export const terminalOutputSchema = z.object({
  id: z.cuid2(),
  name: z.string().nullable(),
  meta: commonObjectMetaSchema,
  status: terminalStatusSchema,
  stateId: z.string().nullable(),
  serviceAccountId: z.string().nullable(),
  serviceAccountMeta: serviceAccountMetaSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type TerminalOutput = z.infer<typeof terminalOutputSchema>

export const terminalQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
  stateId: z.string().optional(),
  artifactId: z.string().optional(),
})

export type TerminalQuery = z.infer<typeof terminalQuerySchema>

export function toTerminalOutput(
  terminal: Omit<TerminalOutput, "serviceAccountMeta">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
): TerminalOutput {
  return {
    ...terminal,
    serviceAccountMeta: serviceAccount?.meta ?? null,
  }
}

export function toTerminalDetailsOutput(
  terminal: Omit<TerminalDetailsOutput, "serviceAccountMeta">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
): TerminalDetailsOutput {
  return {
    ...terminal,
    serviceAccountMeta: serviceAccount?.meta ?? null,
  }
}

export const terminalDetailsOutputSchema = z.object({
  ...terminalOutputSchema.shape,
  spec: terminalSpecSchema,
})

export type TerminalDetailsOutput = z.infer<typeof terminalDetailsOutputSchema>

export function toTerminalSessionOutput(
  terminal: Terminal,
  session: TerminalSession,
): TerminalSessionOutput {
  return {
    id: session.id,
    terminalId: terminal.id,
    meta: terminal.meta,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
  }
}
