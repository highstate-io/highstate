import type { ProjectRequestContext } from "../common"
import type { LocalLibraryOverlaySnapshot } from "../library"
import type { LibraryPackageVersionDetails, SnapshotUnitSource } from "../library/project-types"
import type { LibraryModel } from "../shared"
import { createHash } from "node:crypto"
import { isUnitModel, type SelectedLibraryPackage } from "@highstate/contract"
import { requireProjectPermission } from "../common"
import {
  type CatalogSource,
  libraryPackageInputSchema,
  libraryPackageNameInputSchema,
  localOverlayInputSchema,
  type ProjectLibraryCatalog,
  type ProjectLibraryDiagnostic,
  type ProjectLibraryDto,
  type ProjectLibraryImageService,
  type ProjectLibraryResolver,
  type ProjectLibrarySnapshot,
  type ProjectLibraryState,
  type ProjectLibraryStore,
  selectedLibraryPackagesSchema,
  updateLibraryPackageInputSchema,
} from "../library/project-types"
import { canonicalJson, snapshotHash } from "../library/snapshot"

export type {
  ProjectLibraryCatalog,
  ProjectLibraryDiagnostic,
  ProjectLibraryDto,
  ProjectLibrarySnapshot,
} from "../library/project-types"
export {
  libraryPackageInputSchema,
  libraryPackageNameInputSchema,
  localOverlayInputSchema,
  selectedLibraryPackagesSchema,
  updateLibraryPackageInputSchema,
} from "../library/project-types"

export interface ProjectLibraryCatalogProvider {
  virtualModel(projectId: string): Promise<LibraryModel>
  localOverlay(projectId: string): Promise<LibraryModel>
  localOverlayRevision?(projectId: string): Promise<string>
  localOverlaySnapshot?(projectId: string): Promise<LocalLibraryOverlaySnapshot>
  /** True only for the well-known local runtime identity, not arbitrary local Docker settings. */
  supportsLocalOverlay(projectId: string): Promise<boolean>
}

export class ProjectLibraryService {
  private readonly diagnostics = new Map<string, ProjectLibraryDiagnostic[]>()

  constructor(
    private readonly store: ProjectLibraryStore,
    private readonly resolver: ProjectLibraryResolver,
    private readonly images: ProjectLibraryImageService,
    private readonly catalogs: ProjectLibraryCatalogProvider,
    private readonly initialPackages: SelectedLibraryPackage[],
    private readonly onDesiredSnapshot?: (
      projectId: string,
      snapshot: ProjectLibrarySnapshot,
    ) => Promise<void>,
  ) {}

  async getProjectLibrary(context: ProjectRequestContext): Promise<ProjectLibraryDto> {
    requireProjectPermission(context, "library.get")
    return await this.getProjectLibraryCore(context.projectId)
  }

  async getProjectLibraryCore(projectId: string): Promise<ProjectLibraryDto> {
    const state = await this.store.read(projectId)
    const desiredSnapshot = state.desiredSnapshotId
      ? await this.historicalSnapshot(projectId, state.desiredSnapshotId)
      : null
    const image = desiredSnapshot
      ? await this.images.getDesiredImage?.(projectId, desiredSnapshot)
      : undefined
    return { ...state, desiredSnapshot, diagnostics: this.diagnostics.get(projectId) ?? [], image }
  }

  /** Invoke on creation and every unlock. Failed resolution leaves saved initial selections accessible. */
  async bootstrap(projectId: string): Promise<ProjectLibraryDto> {
    await this.store.initialize(
      projectId,
      selectedLibraryPackagesSchema.parse(this.initialPackages),
    )
    const state = await this.store.read(projectId)
    try {
      if (state.desiredSnapshotId)
        await this.activate(
          projectId,
          await this.historicalSnapshot(projectId, state.desiredSnapshotId),
        )
      else await this.propose(projectId, state, state.selectedPackages)
    } catch {
      // proposal/materialization retains the actionable phase diagnostic
    }
    return await this.getProjectLibraryCore(projectId)
  }

  async onProjectUnlocked(projectId: string): Promise<ProjectLibraryDto> {
    return await this.bootstrap(projectId)
  }

  async addPackage(
    context: ProjectRequestContext,
    input: SelectedLibraryPackage,
  ): Promise<ProjectLibrarySnapshot> {
    requireProjectPermission(context, "library.manage")
    const selection = libraryPackageInputSchema.parse(input)
    const state = await this.store.read(context.projectId)
    if (state.selectedPackages.some(pkg => pkg.packageName === selection.packageName))
      throw new Error(`Package "${selection.packageName}" is already selected`)
    return await this.propose(context.projectId, state, [...state.selectedPackages, selection])
  }

  async updatePackage(
    context: ProjectRequestContext,
    input: { packageName: string; version?: string },
  ): Promise<ProjectLibrarySnapshot> {
    requireProjectPermission(context, "library.manage")
    const parsed = updateLibraryPackageInputSchema.parse(input)
    const state = await this.store.read(context.projectId)
    if (!state.selectedPackages.some(pkg => pkg.packageName === parsed.packageName))
      throw new Error(`Package "${parsed.packageName}" is not selected`)
    const selection = {
      packageName: parsed.packageName,
      version:
        parsed.version ??
        (await this.resolver.latestVersion(context.projectId, parsed.packageName)),
    }
    return await this.propose(
      context.projectId,
      state,
      state.selectedPackages.map(pkg =>
        pkg.packageName === selection.packageName ? selection : pkg,
      ),
    )
  }

  async removePackage(
    context: ProjectRequestContext,
    input: { packageName: string },
  ): Promise<ProjectLibrarySnapshot> {
    requireProjectPermission(context, "library.manage")
    const { packageName } = libraryPackageNameInputSchema.parse(input)
    const state = await this.store.read(context.projectId)
    if (!state.selectedPackages.some(pkg => pkg.packageName === packageName))
      throw new Error(`Package "${packageName}" is not selected`)
    return await this.propose(
      context.projectId,
      state,
      state.selectedPackages.filter(pkg => pkg.packageName !== packageName),
    )
  }

  async updateAll(context: ProjectRequestContext): Promise<ProjectLibrarySnapshot> {
    requireProjectPermission(context, "library.manage")
    const state = await this.store.read(context.projectId)
    const selections = await Promise.all(
      state.selectedPackages.map(async pkg => ({
        packageName: pkg.packageName,
        version: await this.resolver.latestVersion(context.projectId, pkg.packageName),
      })),
    )
    return await this.propose(context.projectId, state, selections)
  }

  async listPackageVersions(
    context: ProjectRequestContext,
    input: { packageName: string },
  ): Promise<string[]> {
    requireProjectPermission(context, "library.get")
    return await this.resolver.listVersions(
      context.projectId,
      libraryPackageNameInputSchema.parse(input).packageName,
    )
  }

  async getPackageVersion(
    context: ProjectRequestContext,
    input: SelectedLibraryPackage,
  ): Promise<LibraryPackageVersionDetails> {
    requireProjectPermission(context, "library.get")
    return await this.resolver.getVersion(context.projectId, libraryPackageInputSchema.parse(input))
  }

  async setLocalOverlay(
    context: ProjectRequestContext,
    input: { enabled: boolean },
  ): Promise<ProjectLibraryCatalog> {
    requireProjectPermission(context, "library.manage")
    const { enabled } = localOverlayInputSchema.parse(input)
    if (enabled && !(await this.catalogs.supportsLocalOverlay(context.projectId)))
      throw new Error("Local overlays require the well-known local runtime")
    await this.store.setOverlay(context.projectId, enabled)
    return await this.catalog(context.projectId)
  }

  async retryDesiredImage(context: ProjectRequestContext): Promise<unknown> {
    requireProjectPermission(context, "library.manage")
    return await this.materialize(
      context.projectId,
      await this.desiredSnapshot(context.projectId),
      true,
    )
  }

  async desiredSnapshot(projectId: string): Promise<ProjectLibrarySnapshot> {
    const state = await this.store.read(projectId)
    if (!state.desiredSnapshotId)
      throw new Error("Project library has no resolved desired snapshot")
    return await this.historicalSnapshot(projectId, state.desiredSnapshotId)
  }

  async historicalSnapshot(projectId: string, snapshotId: string): Promise<ProjectLibrarySnapshot> {
    const snapshot = await this.store.snapshot(projectId, snapshotId)
    const { id: _id, hash, ...content } = snapshot
    if (snapshotHash(content) !== hash) throw new Error("Library snapshot hash mismatch")
    return snapshot
  }

  /** Resolves portable sources strictly inside a persisted graph, with no backend-host package resolution. */
  async getSnapshotUnitSources(
    projectId: string,
    snapshotId: string,
    unitTypes: string[],
  ): Promise<SnapshotUnitSource[]> {
    const snapshot = await this.historicalSnapshot(projectId, snapshotId)
    return unitTypes.map(unitType => {
      const component = snapshot.model.components[unitType]
      if (!component || !isUnitModel(component))
        throw new Error(`Packaged unit "${unitType}" not found`)
      const owner = snapshot.sourceManifest.owners[`components:${unitType}`]
      const pkg = snapshot.packages.find(pkg => pkg.packageName === owner)
      if (!pkg?.id) throw new Error(`Missing snapshot membership for "${unitType}"`)
      const implementationPath = component.source.path
        ? `./dist/${component.source.path}`
        : "./dist"
      const sourceHash =
        snapshot.sourceManifest.packages[component.source.package]?.sourceHashes?.[
          `${implementationPath}/index.js`
        ]
      if (sourceHash === undefined) throw new Error(`Missing frozen source hash for "${unitType}"`)
      return {
        unitType,
        snapshotId,
        libraryPackageVersionId: pkg.id,
        packageName: pkg.packageName,
        version: pkg.version,
        implementationPackage: component.source.package,
        relativePath: `node_modules/${component.source.package}/${implementationPath.slice(2)}`,
        sourceHash,
      }
    })
  }

  async getCatalog(context: ProjectRequestContext): Promise<ProjectLibraryCatalog> {
    requireProjectPermission(context, "library.get")
    return await this.catalog(context.projectId)
  }

  async historicalCatalog(
    projectId: string,
    snapshotId: string,
  ): Promise<Pick<ProjectLibraryCatalog, "model" | "sources" | "snapshotId">> {
    const snapshot = await this.historicalSnapshot(projectId, snapshotId)
    return { model: snapshot.model, sources: this.packageSources(snapshot), snapshotId }
  }

  async catalog(projectId: string): Promise<ProjectLibraryCatalog> {
    const state = await this.store.read(projectId)
    const snapshot = state.desiredSnapshotId
      ? await this.historicalSnapshot(projectId, state.desiredSnapshotId)
      : null
    const model = structuredClone(snapshot?.model ?? { components: {}, entities: {} })
    const sources = snapshot ? this.packageSources(snapshot) : {}
    const virtual = await this.catalogs.virtualModel(projectId)
    this.mergeCatalog(model, sources, virtual, { kind: "virtual" })
    const overlay: ProjectLibraryCatalog["overlay"] = {
      enabled: state.localOverlayEnabled,
      active: false,
      conflicts: [],
    }
    if (state.localOverlayEnabled) {
      if (!(await this.catalogs.supportsLocalOverlay(projectId)))
        overlay.reason = "Local overlays require the well-known local runtime"
      else {
        try {
          const localSnapshot = await this.catalogs.localOverlaySnapshot?.(projectId)
          const local = localSnapshot?.model ?? (await this.catalogs.localOverlay(projectId))
          for (const collection of ["components", "entities"] as const) {
            for (const type of Object.keys(local[collection]))
              if (Object.hasOwn(model[collection], type))
                overlay.conflicts.push(`${collection}:${type}`)
          }
          if (overlay.conflicts.length)
            overlay.reason = "The complete local overlay is disabled because definitions conflict"
          else {
            const revision =
              localSnapshot?.revision ??
              (await this.catalogs.localOverlayRevision?.(projectId)) ??
              createHash("sha256").update(canonicalJson(local)).digest("hex")
            this.mergeCatalog(model, sources, local, { kind: "local" })
            overlay.active = true
            overlay.revision = revision
          }
        } catch {
          overlay.reason = "Local library overlay could not be loaded"
        }
      }
    }
    return { model, sources, snapshotId: snapshot?.id ?? null, overlay }
  }

  private packageSources(snapshot: ProjectLibrarySnapshot): Record<string, CatalogSource> {
    const sources: Record<string, CatalogSource> = {}
    for (const [key, packageName] of Object.entries(snapshot.sourceManifest.owners)) {
      const pkg = snapshot.packages.find(pkg => pkg.packageName === packageName)
      if (!pkg) throw new Error(`Snapshot owner "${packageName}" is not a member`)
      sources[key] = { kind: "package", packageName, version: pkg.version, snapshotId: snapshot.id }
    }
    return sources
  }

  private mergeCatalog(
    model: LibraryModel,
    sources: Record<string, CatalogSource>,
    addition: LibraryModel,
    source: CatalogSource,
  ): void {
    for (const collection of ["components", "entities"] as const) {
      for (const [type, definition] of Object.entries(addition[collection])) {
        if (Object.hasOwn(model[collection], type))
          throw new Error(`Duplicate catalog definition "${collection}:${type}"`)
        Object.defineProperty(model[collection], type, {
          value: definition,
          enumerable: true,
          configurable: true,
          writable: true,
        })
        sources[`${collection}:${type}`] = source
      }
    }
  }

  private async propose(
    projectId: string,
    previous: ProjectLibraryState,
    selections: SelectedLibraryPackage[],
  ): Promise<ProjectLibrarySnapshot> {
    let snapshot: ProjectLibrarySnapshot
    try {
      const content = await this.resolver.resolve(
        projectId,
        selectedLibraryPackagesSchema.parse(selections),
      )
      this.mergeCatalog(
        structuredClone(content.model),
        {},
        await this.catalogs.virtualModel(projectId),
        { kind: "virtual" },
      )
      snapshot = await this.store.commit(projectId, previous, content, snapshotHash(content))
      this.diagnostics.delete(projectId)
    } catch (error) {
      this.diagnostics.set(projectId, [
        {
          phase: "resolution",
          message:
            error instanceof Error
              ? error.message.split("\n")[0]!
              : "Package resolution or selection commit failed",
        },
      ])
      throw error
    }
    await this.activate(projectId, snapshot)
    return snapshot
  }

  private async activate(projectId: string, snapshot: ProjectLibrarySnapshot): Promise<void> {
    let publicationFailed = false
    try {
      await this.onDesiredSnapshot?.(projectId, snapshot)
    } catch {
      publicationFailed = true
    }
    await this.materialize(projectId, snapshot)
    if (publicationFailed)
      this.diagnostics.set(projectId, [
        ...(this.diagnostics.get(projectId) ?? []),
        {
          phase: "publication",
          message:
            "Desired snapshot committed but catalog publication failed; unlock the project to resume",
        },
      ])
  }

  private async materialize(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
    retry = false,
  ): Promise<unknown> {
    try {
      const result = await this.images.ensureDesiredImage(projectId, snapshot, retry)
      this.diagnostics.delete(projectId)
      return result
    } catch {
      this.diagnostics.set(projectId, [
        {
          phase: "image",
          message: "Desired snapshot image materialization failed; retry the image build",
        },
      ])
      return undefined
    }
  }
}
