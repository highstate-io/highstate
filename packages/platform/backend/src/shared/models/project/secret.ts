import type { ServiceAccount } from "../../../database"
import { globalCommonObjectMetaSchema, serviceAccountMetaSchema, z } from "@highstate/contract"
import { collectionQuerySchema } from "../base"

export const secretOutputSchema = z.object({
  id: z.cuid2(),
  meta: globalCommonObjectMetaSchema,
  name: z.string().nullable(),
  systemName: z.string().nullable(),
  stateId: z.cuid2().nullable(),
  serviceAccountId: z.cuid2().nullable(),
  serviceAccountMeta: serviceAccountMetaSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type SecretOutput = z.infer<typeof secretOutputSchema>

export const secretQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
  stateId: z.string().optional(),
})

export type SecretQuery = z.infer<typeof secretQuerySchema>

export function toSecretOutput(
  secret: Omit<SecretOutput, "serviceAccountMeta">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
): SecretOutput {
  return {
    ...secret,
    serviceAccountMeta: serviceAccount?.meta ?? null,
  }
}

export enum SystemSecretNames {
  PulumiPassword = "pulumi-password",
}
