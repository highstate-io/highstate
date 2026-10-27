import {
  type ProjectLibraryCatalog,
  type ProjectLibraryDto,
  libraryPackageInputSchema,
  libraryPackageNameInputSchema,
  localOverlayInputSchema,
  updateLibraryPackageInputSchema,
} from "@highstate/backend"
import { isUnitModel } from "@highstate/contract"
import { z } from "zod"
import { projectProcedure, router } from "../trpc"

const projectInput = { projectId: z.cuid2() }

export const libraryRouter = router({
  get: projectProcedure.query(async ({ ctx }): Promise<ProjectLibraryCatalog> => {
    return await ctx.projectLibraryService.getCatalog(ctx.requestContext)
  }),

  getProjectLibrary: projectProcedure.query(async ({ ctx }): Promise<ProjectLibraryDto> => {
    return await ctx.projectLibraryService.getProjectLibrary(ctx.requestContext)
  }),

  addPackage: projectProcedure
    .input(libraryPackageInputSchema.extend(projectInput))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectLibraryService.addPackage(ctx.requestContext, {
        packageName: input.packageName,
        version: input.version,
      })
    }),

  updatePackage: projectProcedure
    .input(updateLibraryPackageInputSchema.extend(projectInput))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectLibraryService.updatePackage(ctx.requestContext, {
        packageName: input.packageName,
        version: input.version,
      })
    }),

  removePackage: projectProcedure
    .input(libraryPackageNameInputSchema.extend(projectInput))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectLibraryService.removePackage(ctx.requestContext, {
        packageName: input.packageName,
      })
    }),

  updateAll: projectProcedure.mutation(async ({ ctx }) => {
    return await ctx.projectLibraryService.updateAll(ctx.requestContext)
  }),

  listPackageVersions: projectProcedure
    .input(libraryPackageNameInputSchema.extend(projectInput))
    .query(async ({ ctx, input }): Promise<string[]> => {
      return await ctx.projectLibraryService.listPackageVersions(ctx.requestContext, {
        packageName: input.packageName,
      })
    }),

  getPackageVersion: projectProcedure
    .input(libraryPackageInputSchema.extend(projectInput))
    .query(async ({ ctx, input }) => {
      return await ctx.projectLibraryService.getPackageVersion(ctx.requestContext, {
        packageName: input.packageName,
        version: input.version,
      })
    }),

  setLocalOverlay: projectProcedure
    .input(localOverlayInputSchema.extend(projectInput))
    .mutation(async ({ ctx, input }) => {
      return await ctx.projectLibraryService.setLocalOverlay(ctx.requestContext, {
        enabled: input.enabled,
      })
    }),

  retryDesiredImage: projectProcedure.mutation(async ({ ctx }) => {
    await ctx.projectLibraryService.retryDesiredImage(ctx.requestContext)
  }),

  getUnitSourceHashes: projectProcedure
    .input(z.object({ unitTypes: z.string().array() }))
    .query(async ({ ctx, input }) => {
      const catalog = await ctx.projectLibraryService.getCatalog(ctx.requestContext)
      const units = input.unitTypes.filter(type => {
        const component = catalog.model.components[type]
        return component && isUnitModel(component)
      })
      const packaged = units.filter(
        type => catalog.sources[`components:${type}`]?.kind === "package",
      )
      const local = units.filter(type => catalog.sources[`components:${type}`]?.kind === "local")
      const sources =
        catalog.snapshotId && packaged.length
          ? await ctx.projectLibraryService.getSnapshotUnitSources(
              input.projectId,
              catalog.snapshotId,
              packaged,
            )
          : []
      const localSources = local.length
        ? await ctx.libraryBackend.getResolvedUnitSources("local", local)
        : []
      return [...sources, ...localSources].map(({ unitType, sourceHash }) => ({
        unitType,
        sourceHash,
      }))
    }),
})
