import { z } from "zod"
import { publicProcedure, router } from "../trpc"
import { instanceIdSchema } from "@highstate/contract"
import { createPanelLaunchTicket } from "../utils/panel-session"

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

  forgetInstanceStates: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceIds: z.array(instanceIdSchema).min(1),
        deleteSecrets: z.boolean().default(false),
        clearTerminalData: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.instanceStateService.forgetInstanceStates(input.projectId, input.instanceIds, {
        deleteSecrets: input.deleteSecrets,
        clearTerminalData: input.clearTerminalData,
      })
    }),

  getOutputReferencedEntities: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
        output: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.projectService.getProjectOrThrow(input.projectId)
      const library = await ctx.libraryBackend.loadLibrary(project.libraryId)

      return await ctx.entitySnapshotService.listReferencedEntitySnapshotsForOutput(
        input.projectId,
        input.stateId,
        input.output,
        library,
      )
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

  getInstancePanels: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelIds: z.array(z.cuid2()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const panels = await Promise.all(
        input.panelIds.map(panelId =>
          ctx.settingsService.getPanelDetails(input.projectId, panelId),
        ),
      )

      return panels.filter(panel => panel !== null)
    }),

  createPanelLaunch: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelId: z.cuid2(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)
      const panel = await database.panel.findUnique({
        where: { id: input.panelId },
        select: { id: true, workerVersionId: true },
      })
      if (!panel) {
        throw new Error(`Panel "${input.panelId}" not found`)
      }
      const endpoint = ctx.panelEndpointManager.getPanelEndpoint(
        input.projectId,
        panel.workerVersionId,
        panel.id,
      )
      if (!endpoint) {
        throw new Error(`Panel "${input.panelId}" is offline`)
      }

      const ticket = createPanelLaunchTicket(input.projectId, panel.id, endpoint.workerInstanceId)
      const port = process.env.HIGHSTATE_DESIGNER_PORT ?? process.env.NITRO_PORT ?? "7283"

      return {
        url: `http://${panel.id}.panels.highstate.localhost:${port}/api/panels/launch?ticket=${ticket}`,
      }
    }),

  watchPanelAvailability: publicProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelId: z.cuid2(),
      }),
    )
    .subscription(async function* ({ input, ctx, signal }) {
      const database = await ctx.database.forProject(input.projectId)
      const panel = await database.panel.findUnique({
        where: { id: input.panelId },
        select: { workerVersionId: true },
      })
      if (!panel) {
        throw new Error(`Panel "${input.panelId}" not found`)
      }

      const subscription = ctx.pubsubManager.subscribe(
        ["panel-availability", input.projectId, input.panelId],
        signal,
      )
      yield {
        online: ctx.panelEndpointManager.isPanelAvailable(
          input.projectId,
          panel.workerVersionId,
          input.panelId,
        ),
      }

      for await (const event of await subscription) {
        yield event
      }
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
