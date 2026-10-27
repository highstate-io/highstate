import type { LibraryModel } from "../shared"
import type {
  ProjectLibraryCatalog,
  ProjectLibraryDto,
  ProjectLibrarySnapshot,
  ResolvedLibraryPackage,
} from "./project-types"
import { componentModelSchema, entityModelSchema } from "@highstate/contract"
import { z } from "zod"
import {
  exactPackageVersionSchema,
  libraryPackageInputSchema,
  npmPackageNameSchema,
  selectedLibraryPackagesSchema,
} from "./project-types"

export const libraryModelSchema: z.ZodType<LibraryModel> = z.object({
  components: z.record(z.string(), componentModelSchema.loose()),
  entities: z.record(z.string(), entityModelSchema.loose()),
})
export const librarySourceManifestSchema = z.object({
  sourceHashes: z.record(z.string(), z.number()).optional(),
})
export const libraryCompatibilitySchema = z.object({
  runtimeProtocolVersion: z.number().int().positive(),
  packageFormatVersion: z.number().int().positive(),
  bunVersion: exactPackageVersionSchema,
  pulumiVersion: exactPackageVersionSchema,
})
export const librarySnapshotSourceManifestSchema = z.object({
  packages: z.record(npmPackageNameSchema, librarySourceManifestSchema),
  owners: z.record(z.string(), npmPackageNameSchema),
})
export const resolvedLibraryPackageSchema: z.ZodType<ResolvedLibraryPackage> =
  libraryPackageInputSchema.extend({
    id: z.string().optional(),
    registryUrl: z.url(),
    packageIntegrity: z.string().min(1),
    tarballUrl: z.url(),
    model: libraryModelSchema,
    sourceManifest: librarySourceManifestSchema,
    packageMetadata: z.object({
      description: z.string().optional(),
      homepage: z.string().optional(),
      license: z.string().optional(),
      engines: z.record(z.string(), z.string()).optional(),
    }),
  })
export const projectLibrarySnapshotSchema: z.ZodType<ProjectLibrarySnapshot> = z.object({
  id: z.string(),
  hash: z.string(),
  selectedPackages: selectedLibraryPackagesSchema,
  packages: z.array(resolvedLibraryPackageSchema),
  lockfile: z.string(),
  model: libraryModelSchema,
  sourceManifest: librarySnapshotSourceManifestSchema,
  compatibility: libraryCompatibilitySchema,
})
export const projectLibraryStateSchema = z.object({
  selectedPackages: selectedLibraryPackagesSchema,
  desiredSnapshotId: z.string().nullable(),
  localOverlayEnabled: z.boolean(),
})
export const projectLibraryDiagnosticSchema = z.object({
  phase: z.enum(["resolution", "image", "publication"]),
  message: z.string(),
})
export const projectLibraryDtoSchema: z.ZodType<ProjectLibraryDto> =
  projectLibraryStateSchema.extend({
    desiredSnapshot: projectLibrarySnapshotSchema.nullable(),
    diagnostics: z.array(projectLibraryDiagnosticSchema),
    image: z.unknown().optional(),
  })
export const projectLibraryCatalogSchema: z.ZodType<ProjectLibraryCatalog> = z.object({
  model: libraryModelSchema,
  sources: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("package"),
        packageName: npmPackageNameSchema,
        version: exactPackageVersionSchema,
        snapshotId: z.string(),
      }),
      z.object({ kind: z.literal("local") }),
      z.object({ kind: z.literal("virtual") }),
    ]),
  ),
  snapshotId: z.string().nullable(),
  overlay: z.object({
    enabled: z.boolean(),
    active: z.boolean(),
    conflicts: z.array(z.string()),
    reason: z.string().optional(),
    revision: z.string().optional(),
  }),
})
