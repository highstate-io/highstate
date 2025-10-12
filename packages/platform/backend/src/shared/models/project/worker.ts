import type { ApiKey, ServiceAccount } from "../../../database"
import { commonObjectMetaSchema, serviceAccountMetaSchema } from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"
import { apiKeyMetaSchema } from "./api-key"

export const MAX_WORKER_START_ATTEMPTS = 3

const SHA256_PREFIX = "sha256:"
const SHA256_REGEX = /^[a-f0-9]{64}$/

export function extractDigestFromImage(image: string): string {
  const atIndex = image.indexOf("@")
  if (atIndex === -1) {
    throw new Error(`Invalid worker image "${image}": missing digest.`)
  }

  const digestPart = image.slice(atIndex + 1)
  if (!digestPart.startsWith(SHA256_PREFIX)) {
    throw new Error(`Invalid worker image "${image}": digest must start with "sha256:".`)
  }

  const digest = digestPart.slice(SHA256_PREFIX.length).toLowerCase()
  if (!SHA256_REGEX.test(digest)) {
    throw new Error(`Invalid worker image "${image}": digest must be 64 hex chars.`)
  }

  return digest
}

export function getWorkerIdentity(image: string): string {
  const atIndex = image.indexOf("@")
  const withoutDigest = atIndex === -1 ? image : image.slice(0, atIndex)
  const lastColon = withoutDigest.lastIndexOf(":")
  const lastSlash = withoutDigest.lastIndexOf("/")

  if (lastColon > -1 && lastColon > lastSlash) {
    return withoutDigest.slice(0, lastColon)
  }

  return withoutDigest
}

export const workerVersionStatusSchema = z.enum([
  "unknown",
  "starting",
  "running",
  "stopping",
  "stopped",
  "error",
])

export type WorkerVersionStatus = z.infer<typeof workerVersionStatusSchema>

export const workerVersionOutputSchema = z.object({
  id: z.cuid2(),
  digest: z.string(),
  meta: commonObjectMetaSchema,
  status: workerVersionStatusSchema,
  enabled: z.boolean(),
  apiKeyId: z.string(),
  apiKeyMeta: apiKeyMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type WorkerVersionOutput = z.infer<typeof workerVersionOutputSchema>

export const workerOutputSchema = z.object({
  id: z.cuid2(),
  identity: z.string(),
  meta: commonObjectMetaSchema,
  serviceAccountId: z.string(),
  serviceAccountMeta: serviceAccountMetaSchema,
  createdAt: z.date(),
})

export type WorkerOutput = z.infer<typeof workerOutputSchema>

export const workerQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
})

export type WorkerQuery = z.infer<typeof workerQuerySchema>

export function toWorkerOutput(
  worker: Omit<WorkerOutput, "meta" | "serviceAccountMeta">,
  lastVersion: Pick<WorkerVersionOutput, "meta"> | null,
  serviceAccount: Pick<ServiceAccount, "meta">,
): WorkerOutput {
  return {
    ...worker,
    meta: lastVersion?.meta ?? { title: "Unknown" },
    serviceAccountMeta: serviceAccount.meta,
  }
}

export function toWorkerVersionOutput(
  version: Omit<WorkerVersionOutput, "apiKeyMeta">,
  apiKey: Pick<ApiKey, "meta">,
): WorkerVersionOutput {
  return {
    ...version,
    apiKeyMeta: apiKey.meta,
  }
}
