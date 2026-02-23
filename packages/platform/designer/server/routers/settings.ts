import { z } from "zod"
import { publicProcedure, router } from "../trpc"
import {
  apiKeyQuerySchema,
  artifactQuerySchema,
  collectionQuerySchema,
  entityQuerySchema,
  pageQuerySchema,
  secretQuerySchema,
  serviceAccountQuerySchema,
  terminalQuerySchema,
  triggerQuerySchema,
  unlockMethodInputSchema,
  workerQuerySchema,
} from "@highstate/backend/shared"

export const settingsRouter = router({
  queryUnlockMethods: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryUnlockMethods(input.projectId, input.query)
    }),

  addUnlockMethod: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        unlockMethod: unlockMethodInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.projectUnlockService.addProjectUnlockMethod(input.projectId, input.unlockMethod)
    }),

  removeUnlockMethod: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        unlockMethodId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.projectUnlockService.removeProjectUnlockMethod(
        input.projectId,
        input.unlockMethodId,
      )
    }),

  queryOperations: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryOperations(input.projectId, input.query)
    }),

  queryTerminals: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: terminalQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryTerminals(input.projectId, input.query)
    }),

  queryPages: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: pageQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryPages(input.projectId, input.query)
    }),

  querySecrets: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: secretQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.querySecrets(input.projectId, input.query)
    }),

  queryTriggers: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: triggerQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryTriggers(input.projectId, input.query)
    }),

  queryWorkers: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: workerQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryWorkers(input.projectId, input.query)
    }),

  queryWorkerVersions: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        workerId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryWorkerVersions(
        input.projectId,
        input.workerId,
        input.query,
      )
    }),

  queryArtifacts: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: artifactQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryArtifacts(input.projectId, input.query)
    }),

  queryServiceAccounts: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: serviceAccountQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryServiceAccounts(input.projectId, input.query)
    }),

  queryApiKeys: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: apiKeyQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryApiKeys(input.projectId, input.query)
    }),

  queryEntities: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: entityQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntities(input.projectId, input.query)
    }),

  getEntityDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        entityId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getEntityDetails(input.projectId, input.entityId)
    }),

  getEntitySnapshotDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        snapshotId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const details = await ctx.settingsService.getEntitySnapshotDetails(
        input.projectId,
        input.snapshotId,
      )

      if (!details) {
        return null
      }

      const project = await ctx.projectService.getProjectOrThrow(input.projectId)
      const library = await ctx.libraryBackend.loadLibrary(project.libraryId)

      const reconstructed = await (async () => {
        try {
          return await ctx.entitySnapshotService.reconstructSnapshotContent(
            input.projectId,
            input.snapshotId,
            library,
          )
        } catch {
          return null
        }
      })()

      if (!reconstructed) {
        return details
      }

      return {
        ...details,
        snapshot: {
          ...details.snapshot,
          content: reconstructed,
        },
      }
    }),

  queryEntitySnapshotsForEntity: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        entityId: z.string(),
        excludeSnapshotId: z.string().optional(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntitySnapshotsForEntity(
        input.projectId,
        input.entityId,
        input.query,
        input.excludeSnapshotId,
      )
    }),

  queryEntitySnapshotsForInstanceOperation: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
        operationId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntitySnapshotsForInstanceOperation(
        input.projectId,
        input.stateId,
        input.operationId,
        input.query,
      )
    }),

  queryEntityOutgoingReferences: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        entityId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntityOutgoingReferences(
        input.projectId,
        input.entityId,
        input.query,
      )
    }),

  queryEntitySnapshotOutgoingReferences: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        snapshotId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntitySnapshotOutgoingReferences(
        input.projectId,
        input.snapshotId,
        input.query,
      )
    }),

  queryEntityIncomingReferences: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        entityId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntityIncomingReferences(
        input.projectId,
        input.entityId,
        input.query,
      )
    }),

  queryEntitySnapshotIncomingReferences: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        snapshotId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.queryEntitySnapshotIncomingReferences(
        input.projectId,
        input.snapshotId,
        input.query,
      )
    }),

  getTerminalDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getTerminalDetails(input.projectId, input.terminalId)
    }),

  getServiceAccountDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        serviceAccountId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getServiceAccountDetails(
        input.projectId,
        input.serviceAccountId,
      )
    }),

  getApiKeyDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        apiKeyId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getApiKeyDetails(input.projectId, input.apiKeyId)
    }),

  getWorkerDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        workerId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getWorkerDetails(input.projectId, input.workerId)
    }),

  getWorkerVersionDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        versionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getWorkerVersionDetails(input.projectId, input.versionId)
    }),

  getPageDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getPageDetails(input.projectId, input.pageId)
    }),

  getSecretDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        secretId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getSecretDetails(input.projectId, input.secretId)
    }),

  getSecretValue: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        secretId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getSecretValue(input.projectId, input.secretId)
    }),

  getArtifactDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        artifactId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getArtifactDetails(input.projectId, input.artifactId)
    }),

  getOperationDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        operationId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getOperationDetails(input.projectId, input.operationId)
    }),

  getTriggerDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getTriggerDetails(input.projectId, input.triggerId)
    }),

  getUnlockMethodDetails: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        unlockMethodId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getUnlockMethodDetails(input.projectId, input.unlockMethodId)
    }),

  getTerminalSessions: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        terminalId: z.string(),
        query: collectionQuerySchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.settingsService.getTerminalSessions(
        input.projectId,
        input.terminalId,
        input.query,
      )
    }),
})
