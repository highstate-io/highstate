import type {
  LibraryCompatibility,
  LibrarySnapshotSourceManifest,
  LibrarySourceManifest,
  SelectedLibraryPackage,
} from "@highstate/contract"
import type { LibraryModel } from "../shared"
import { z } from "zod"

export const npmPackageNameSchema = z
  .string()
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)
  .refine(
    name => !["node_modules", "favicon.ico"].includes(name.split("/").at(-1)!),
    "Reserved npm package name",
  )
export const exactPackageVersionSchema = z
  .string()
  .max(256)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/,
  )
  .refine(
    version =>
      version
        .split(/[.+-]/)
        .slice(0, 3)
        .every(part => Number.isSafeInteger(Number(part))),
    "Invalid npm semantic version",
  )
export const libraryPackageInputSchema = z
  .object({ packageName: npmPackageNameSchema, version: exactPackageVersionSchema })
  .strict()
export const libraryPackageNameInputSchema = z
  .object({ packageName: npmPackageNameSchema })
  .strict()
export const updateLibraryPackageInputSchema = libraryPackageNameInputSchema
  .extend({ version: exactPackageVersionSchema.optional() })
  .strict()
export const localOverlayInputSchema = z.object({ enabled: z.boolean() }).strict()
export const libraryPackageVersionDetailsSchema = z.object({
  name: npmPackageNameSchema,
  version: exactPackageVersionSchema,
  dist: z.object({ tarball: z.url(), integrity: z.string().min(1) }),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  engines: z.record(z.string(), z.string()).optional(),
})
export type LibraryPackageInput = z.infer<typeof libraryPackageInputSchema>
export type UpdateLibraryPackageInput = z.infer<typeof updateLibraryPackageInputSchema>
export type LibraryPackageVersionDetails = z.infer<typeof libraryPackageVersionDetailsSchema>
export const selectedLibraryPackagesSchema = z
  .array(libraryPackageInputSchema)
  .transform((items, context) => {
    if (new Set(items.map(item => item.packageName)).size !== items.length) {
      context.addIssue({ code: "custom", message: "Duplicate package selection" })
    }

    return items.toSorted((a, b) =>
      a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0,
    )
  })

export type ResolvedLibraryPackage = SelectedLibraryPackage & {
  id?: string
  registryUrl: string
  packageIntegrity: string
  tarballUrl: string
  model: LibraryModel
  sourceManifest: LibrarySourceManifest
  packageMetadata: {
    description?: string
    homepage?: string
    license?: string
    engines?: Record<string, string>
  }
}
export type LibrarySnapshotContent = {
  selectedPackages: SelectedLibraryPackage[]
  packages: ResolvedLibraryPackage[]
  lockfile: string
  model: LibraryModel
  sourceManifest: LibrarySnapshotSourceManifest
  compatibility: LibraryCompatibility
}
export type ProjectLibrarySnapshot = LibrarySnapshotContent & { id: string; hash: string }
export type ProjectLibraryState = {
  selectedPackages: SelectedLibraryPackage[]
  desiredSnapshotId: string | null
  localOverlayEnabled: boolean
}
export type ProjectLibraryDiagnostic = {
  phase: "resolution" | "image" | "publication"
  message: string
}
export type ProjectLibraryDto = ProjectLibraryState & {
  desiredSnapshot: ProjectLibrarySnapshot | null
  diagnostics: ProjectLibraryDiagnostic[]
  image?: unknown
}

export interface ProjectLibraryResolver {
  resolve(projectId: string, selections: SelectedLibraryPackage[]): Promise<LibrarySnapshotContent>
  listVersions(projectId: string, packageName: string): Promise<string[]>
  getVersion(
    projectId: string,
    selection: SelectedLibraryPackage,
  ): Promise<LibraryPackageVersionDetails>
  latestVersion(projectId: string, packageName: string): Promise<string>
}

export interface ProjectLibraryStore {
  initialize(projectId: string, selections: SelectedLibraryPackage[]): Promise<void>
  read(projectId: string): Promise<ProjectLibraryState>
  snapshot(projectId: string, snapshotId: string): Promise<ProjectLibrarySnapshot>
  /**
   * Atomically persist immutable versions, membership, snapshot, and selections, or throw on a stale previous state.
   */
  commit(
    projectId: string,
    previous: ProjectLibraryState,
    content: LibrarySnapshotContent,
    hash: string,
  ): Promise<ProjectLibrarySnapshot>
  setOverlay(projectId: string, enabled: boolean): Promise<void>
}

export interface ProjectLibraryImageService {
  /**
   * Called only after the desired snapshot transaction commits. Must be idempotent and resume persisted builds.
   */
  ensureDesiredImage(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
    retry?: boolean,
  ): Promise<unknown>
  getDesiredImage?(projectId: string, snapshot: ProjectLibrarySnapshot): Promise<unknown>
}

export type CatalogSource =
  | { kind: "package"; packageName: string; version: string; snapshotId: string }
  | { kind: "local" }
  | { kind: "virtual" }
export type ProjectLibraryCatalog = {
  model: LibraryModel
  sources: Record<string, CatalogSource>
  snapshotId: string | null
  overlay: {
    enabled: boolean
    active: boolean
    conflicts: string[]
    reason?: string
    revision?: string
  }
}

export type SnapshotUnitSource = {
  unitType: string
  snapshotId: string
  libraryPackageVersionId: string
  packageName: string
  version: string
  implementationPackage: string
  relativePath: string
  sourceHash: number
}
