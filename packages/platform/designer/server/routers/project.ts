import { z } from "zod"
import { publicProcedure, router } from "../trpc"
import {
  instanceModelSchema,
  instanceModelPatchSchema,
  hubModelSchema,
  hubModelPatchSchema,
  instanceIdSchema,
} from "@highstate/contract"
import { projectInputSchema, unlockMethodInputSchema } from "@highstate/backend/shared"

export const projectRouter = router({
  getProjects: publicProcedure.query(async ({ ctx }) => {
    return await ctx.projectService.getProjects()
  }),

  createProject: publicProcedure
    .input(
      z.object({
        projectInput: projectInputSchema,
        unlockMethodInput: unlockMethodInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.createProject(input.projectInput, input.unlockMethodInput)
    }),

  watchProjectNodes: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .subscription(async ({ input, ctx, signal }) => {
      return ctx.pubsubManager.subscribe(["project-model", input.projectId], signal)
    }),

  getProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.projectService.getProjectOrThrow(input.projectId)
    }),

  getProjectModel: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.projectService.getProjectModel(input.projectId)
    }),

  createManyNodes: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instances: z.array(instanceModelSchema),
        hubs: z.array(hubModelSchema),
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.createNodes(input.projectId, input.instances, input.hubs)
    }),

  updateInstance: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
        patch: instanceModelPatchSchema,
      }),
    )
    .output(instanceModelSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.updateInstance(input.projectId, input.instanceId, input.patch)
    }),

  renameInstance: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
        newName: z.string(),
      }),
    )
    .output(instanceModelSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.renameInstance(
        input.projectId,
        input.instanceId,
        input.newName,
      )
    }),

  deleteInstance: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.deleteInstance(input.projectId, input.instanceId)
    }),

  updateHub: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        hubId: z.string(),
        patch: hubModelPatchSchema,
      }),
    )
    .output(hubModelSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.updateHub(input.projectId, input.hubId, input.patch)
    }),

  deleteHub: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        hubId: z.string(),
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.deleteHub(input.projectId, input.hubId)
    }),
})
