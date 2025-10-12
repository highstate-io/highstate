import { z } from "zod"
import { publicProcedure, router } from "../trpc"
import { instanceIdSchema } from "@highstate/contract"

export const stateRouter = router({
  getInstanceStates: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.instanceStateService.getInstanceStates(input.projectId, {
        includeEvaluationState: true,
        includeExtra: true,
        includeLastOperationState: true,
        loadCustomStatuses: true,
      })
    }),

  watchInstanceStates: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      return await ctx.pubsubManager.subscribe(["instance-state", input.projectId], signal)
    }),

  forgetInstanceState: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
        deleteSecrets: z.boolean().default(false),
        clearTerminalData: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.instanceStateService.forgetInstanceState(input.projectId, input.instanceId, {
        deleteSecrets: input.deleteSecrets,
        clearTerminalData: input.clearTerminalData,
      })
    }),

  getInstanceLocks: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      return await database.instanceLock.findMany()
    }),

  watchInstanceLocks: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(({ input, ctx, signal }) => {
      return ctx.pubsubManager.subscribe(["instance-lock", input.projectId], signal)
    }),

  getInstanceSecrets: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        stateId: z.cuid2(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.secretService.getInstanceSecretValues(input.projectId, input.stateId)
    }),

  updateInstanceSecrets: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        stateId: z.cuid2(),
        secretValues: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.secretService.updateInstanceSecrets(
        input.projectId,
        input.stateId,
        input.secretValues,
      )
    }),

  getPage: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      const page = await database.page.findUnique({
        where: { id: input.pageId },
      })

      return page
    }),

  getInstancePages: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      const pages = await database.page.findMany({
        where: { id: { in: input.pageIds } },
      })

      return pages.reduce(
        (acc, page) => {
          acc[page.id] = page
          return acc
        },
        {} as Record<string, any>,
      )
    }),

  getInstanceTriggers: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)

      const triggers = await database.trigger.findMany({
        where: { id: { in: input.triggerIds } },
      })

      return triggers.reduce(
        (acc, trigger) => {
          acc[trigger.id] = trigger
          return acc
        },
        {} as Record<string, any>,
      )
    }),

  unlockProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        decryptedIdentity: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.projectUnlockService.unlockProject(input.projectId, input.decryptedIdentity)
    }),

  watchUnlockState: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async function* ({ input, ctx, signal }) {
      const subscription = ctx.pubsubManager.subscribe(
        ["project-unlock-state", input.projectId],
        signal,
      )

      // always emit the current lock state when subscribing to allow reconnecting clients to get the current state
      yield await ctx.projectUnlockService.getProjectUnlockState(input.projectId)

      for await (const isUnlocked of await subscription) {
        yield isUnlocked
      }
    }),
})
