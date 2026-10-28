import { instanceIdSchema } from "@highstate/contract"
import { z } from "zod"
import { backendProcedure, projectProcedure, router } from "../trpc"
import { getHostedAuthConfig, isHostedAuth } from "../utils/auth-config"
import { createPanelLaunchTicket } from "../utils/panel-session"

export const stateRouter = router({
  getInstanceStates: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageSize: z.number().int().nonnegative().optional(),
        pageToken: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.instanceStateService.getInstanceStates(
        ctx.requestContext,
        {
          includeEvaluationState: true,
          includeExtra: true,
          includeLastOperationState: true,
          loadCustomStatuses: true,
        },
        input,
      )
    }),

  watchInstanceStates: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      const visible = await ctx.instanceStateService.getVisibleStateIds(ctx.requestContext)
      const events = await ctx.pubsubManager.subscribe(["instance-state", input.projectId], signal)
      return (async function* () {
        for await (const event of events) {
          if (event.type === "deleted") {
            if (visible.delete(event.stateId)) {
              yield event
            }

            continue
          }

          const current = await ctx.instanceStateService.getVisibleStateIds(ctx.requestContext)

          for (const id of current) {
            visible.add(id)
          }

          if (event.type === "patched-batch") {
            const patches = event.patches.filter(patch => current.has(patch.stateId))
            if (patches.length > 0) {
              yield { ...event, patches }
            }
          } else if (current.has(event.type === "updated" ? event.state.id : event.stateId)) {
            yield event
          }
        }
      })()
    }),

  forgetInstanceStates: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceIds: z.array(instanceIdSchema).min(1),
        deleteSecrets: z.boolean().default(false),
        clearTerminalData: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.instanceStateService.forgetInstanceStates(ctx.requestContext, input.instanceIds, {
        deleteSecrets: input.deleteSecrets,
        clearTerminalData: input.clearTerminalData,
      })
    }),

  getOutputReferencedEntities: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        stateId: z.string(),
        output: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.projectService.getProjectOrThrowCore(input.projectId)
      const library = await ctx.libraryBackend.loadLibrary(project.libraryId)

      return await ctx.entitySnapshotService.listReferencedEntitySnapshotsForOutput(
        ctx.requestContext,
        input.stateId,
        input.output,
        library,
      )
    }),

  getInstanceLocks: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const database = await ctx.database.forProject(input.projectId)
      const visible = await ctx.instanceStateService.getVisibleStateIds(ctx.requestContext)
      return await database.instanceLock.findMany({
        where: { stateId: { in: [...visible] } },
        select: { stateId: true, meta: true, acquiredAt: true },
      })
    }),

  watchInstanceLocks: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      await ctx.instanceStateService.getVisibleStateIds(ctx.requestContext)
      const events = await ctx.pubsubManager.subscribe(["instance-lock", input.projectId], signal)
      return (async function* () {
        for await (const event of events) {
          const visible = await ctx.instanceStateService.getVisibleStateIds(ctx.requestContext)

          if (event.type === "locked") {
            const locks = event.locks.filter(lock => visible.has(lock.stateId))
            if (locks.length > 0) {
              yield { ...event, locks }
            }
          } else {
            const stateIds = event.stateIds.filter(id => visible.has(id))
            if (stateIds.length > 0) {
              yield { ...event, stateIds }
            }
          }
        }
      })()
    }),

  getInstanceSecrets: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        stateId: z.cuid2(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.secretService.getInstanceSecretValues(ctx.requestContext, input.stateId)
    }),

  updateInstanceSecrets: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        stateId: z.cuid2(),
        secretValues: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.secretService.updateInstanceSecrets(
        ctx.requestContext,
        input.stateId,
        input.secretValues,
      )
    }),

  getPage: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const pages = await ctx.pageSettingsService.getPages(ctx.requestContext, [input.pageId])
      return pages[0] ?? null
    }),

  getInstancePages: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const pages = await ctx.pageSettingsService.getPages(ctx.requestContext, input.pageIds)

      return pages.reduce(
        (acc, page) => {
          acc[page.id] = page
          return acc
        },
        {} as Record<string, (typeof pages)[number]>,
      )
    }),

  getInstancePanels: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelIds: z.array(z.cuid2()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const panels = await Promise.all(
        input.panelIds.map(panelId => ctx.panelSettingsService.get(ctx.requestContext, panelId)),
      )

      return panels.filter(panel => panel !== null)
    }),

  createPanelLaunch: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelId: z.cuid2(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const panel = await ctx.panelSettingsService.get(ctx.requestContext, input.panelId)
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

      const ticket = createPanelLaunchTicket(
        input.projectId,
        panel.id,
        endpoint.workerInstanceId,
        ctx.designerSessionToken,
      )

      const port = process.env.HIGHSTATE_DESIGNER_PORT ?? process.env.NITRO_PORT ?? "7283"

      return {
        url: isHostedAuth()
          ? `https://${panel.id}.panels.${new URL(getHostedAuthConfig().publicUrl).host}/api/panels/launch?ticket=${ticket}`
          : `http://${panel.id}.panels.highstate.localhost:${port}/api/panels/launch?ticket=${ticket}`,
      }
    }),

  watchPanelAvailability: projectProcedure
    .input(
      z.object({
        projectId: z.cuid2(),
        panelId: z.cuid2(),
      }),
    )
    .subscription(async function* ({ input, ctx, signal }) {
      const authorize = async () =>
        await ctx.panelSettingsService.get(ctx.requestContext, input.panelId)

      const panel = await authorize()

      ctx.revalidate.push(async () => {
        if (!(await authorize())) {
          throw new Error(`Panel "${input.panelId}" not found`)
        }
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

  getInstanceTriggers: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      const triggers = await ctx.triggerSettingsService.getTriggers(
        ctx.requestContext,
        input.triggerIds,
      )

      return triggers.reduce(
        (acc, trigger) => {
          acc[trigger.id] = trigger
          return acc
        },
        {} as Record<string, (typeof triggers)[number]>,
      )
    }),

  unlockProject: backendProcedure
    .input(
      z.object({
        projectId: z.string(),
        decryptedIdentity: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.projectUnlockService.unlockProject(
        ctx.requestContext,
        input.projectId,
        input.decryptedIdentity,
      )
    }),

  watchUnlockState: backendProcedure
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
      yield await ctx.projectUnlockService.getProjectUnlockState(
        ctx.requestContext,
        input.projectId,
      )

      for await (const isUnlocked of await subscription) {
        yield isUnlocked
      }
    }),
})
