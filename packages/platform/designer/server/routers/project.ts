import { z } from "zod"
import { backendProcedure, projectProcedure, publicProcedure, router } from "../trpc"
import {
  instanceModelPatchSchema,
  hubModelSchema,
  hubModelPatchSchema,
  instanceIdSchema,
  instanceModelSchema,
} from "@highstate/contract"
import {
  projectInputSchema,
  projectModelInstanceSchema,
  unlockMethodInputSchema,
} from "@highstate/backend/shared"

export const projectRouter = router({
  getProjects: backendProcedure
    .input(
      z.object({
        pageSize: z.number().int().nonnegative().optional(),
        pageToken: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.projectService.getProjects(ctx.requestContext, input)
    }),

  createProject: backendProcedure
    .input(
      z.object({
        projectInput: projectInputSchema,
        unlockMethodInput: unlockMethodInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.createProject(
        ctx.requestContext,
        input.projectInput,
        input.unlockMethodInput,
      )
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

  getProject: backendProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.projectService.getProjectOrThrow(ctx.requestContext, input.projectId)
    }),

  getProjectModel: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.projectService.getProjectModel(ctx.requestContext)
    }),

  createManyNodes: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        instances: z.array(projectModelInstanceSchema),
        hubs: z.array(hubModelSchema),
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.createNodes(ctx.requestContext, input.instances, input.hubs)
    }),

  updateInstance: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
        patch: instanceModelPatchSchema,
      }),
    )
    .output(instanceModelSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.updateInstance(
        ctx.requestContext,
        input.instanceId,
        input.patch,
      )
    }),

  renameInstance: projectProcedure
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
        ctx.requestContext,
        input.instanceId,
        input.newName,
      )
    }),

  deleteInstance: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        instanceId: instanceIdSchema,
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.deleteInstance(ctx.requestContext, input.instanceId)
    }),

  updateHub: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        hubId: z.string(),
        patch: hubModelPatchSchema,
      }),
    )
    .output(hubModelSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.projectService.updateHub(ctx.requestContext, input.hubId, input.patch)
    }),

  deleteHub: projectProcedure
    .input(
      z.object({
        projectId: z.string(),
        hubId: z.string(),
      }),
    )
    .output(z.void())
    .mutation(async ({ input, ctx }) => {
      await ctx.projectService.deleteHub(ctx.requestContext, input.hubId)
    }),
})
