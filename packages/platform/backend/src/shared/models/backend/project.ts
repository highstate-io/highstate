import { commonObjectMetaSchema, genericNameSchema, timestampsSchema, z } from "@highstate/contract"
import {
  codebaseLibrary,
  codebaseProjectModelStorage,
  globalProjectSpace,
  hostPulumiBackend,
} from "./well-known"

export const projectModelStorageSpecSchema = z.discriminatedUnion("type", [
  z.object({
    /**
     * The project model is stored in the codebase where Highstate is running.
     */
    type: z.literal("codebase"),
  }),
  z.object({
    /**
     * The project model is stored in the project database alongside the project data.
     */
    type: z.literal("database"),
  }),
])

export const projectInputSchema = z.object({
  name: genericNameSchema,
  spaceId: z.cuid2().default(globalProjectSpace.id),
  modelStorageId: z.cuid2().default(codebaseProjectModelStorage.id),
  libraryId: z.cuid2().default(codebaseLibrary.id),
  pulumiBackendId: z.cuid2().default(hostPulumiBackend.id),
  meta: commonObjectMetaSchema,
})

export const projectOutputSchema = z.object({
  id: z.string(),
  name: genericNameSchema,
  meta: commonObjectMetaSchema,
  spaceId: z.cuid2(),
  modelStorageId: z.cuid2(),
  libraryId: z.cuid2(),
  pulumiBackendId: z.cuid2(),
  ...timestampsSchema.shape,
})

export type ProjectModelStorageSpec = z.infer<typeof projectModelStorageSpecSchema>

export type ProjectInput = z.infer<typeof projectInputSchema>
export type ProjectOutput = z.infer<typeof projectOutputSchema>

/**
 * The project unlock suite is something that the frontend
 * needs to unlock the project and provide the backend
 * with the necessary information to decrypt the master key.
 */
export const projectUnlockSuiteSchema = z.object({
  /**
   * The list of encrypted AGE identities that can be used to decrypt the master key of the project.
   *
   * The frontend should try to decrypt at least one of these identities
   * using the password or passkey.
   */
  encryptedIdentities: z.array(z.string()),

  /**
   * Whether one of the identities is a passkey and user should be asked to use it.
   */
  hasPasskey: z.boolean(),
})

export type ProjectUnlockSuite = z.infer<typeof projectUnlockSuiteSchema>

export const projectUnlockStateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("locked"),
    unlockSuite: projectUnlockSuiteSchema.optional(),
  }),
  z.object({
    type: z.literal("unlocked"),
  }),
])

export type ProjectUnlockState = z.infer<typeof projectUnlockStateSchema>

export type { Project } from "../../../database"
