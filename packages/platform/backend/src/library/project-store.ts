import type { SelectedLibraryPackage } from "@highstate/contract"
import type { DatabaseManager } from "../database"
import type { LibraryModel } from "../shared"
import type {
  LibrarySnapshotContent,
  ProjectLibrarySnapshot,
  ProjectLibraryState,
  ProjectLibraryStore,
} from "./project-types"
import { decode, encode } from "@msgpack/msgpack"
import { selectedLibraryPackagesSchema } from "./project-types"
import { canonicalJson, snapshotHash } from "./snapshot"

export class PrismaProjectLibraryStore implements ProjectLibraryStore {
  constructor(private readonly database: DatabaseManager) {}

  async initialize(projectId: string, selections: SelectedLibraryPackage[]): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.projectLibraryState.upsert({
      where: { id: "default" },
      create: { id: "default", selectedPackages: selectedLibraryPackagesSchema.parse(selections) },
      update: {},
    })

    await database.projectLibraryState.updateMany({
      where: { id: "default", desiredSnapshotId: null, selectedPackages: { equals: [] } },
      data: { selectedPackages: selectedLibraryPackagesSchema.parse(selections) },
    })
  }

  async read(projectId: string): Promise<ProjectLibraryState> {
    const database = await this.database.forProject(projectId)
    const state = await database.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } })
    return {
      selectedPackages: selectedLibraryPackagesSchema.parse(state.selectedPackages),
      desiredSnapshotId: state.desiredSnapshotId,
      localOverlayEnabled: state.localOverlayEnabled,
    }
  }

  async snapshot(projectId: string, snapshotId: string): Promise<ProjectLibrarySnapshot> {
    const database = await this.database.forProject(projectId)

    const snapshot = await database.librarySnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
      include: { versions: { include: { libraryPackageVersion: true } } },
    })

    const packages = snapshot.versions.map(({ libraryPackageVersion: pkg }) => ({
      id: pkg.id,
      packageName: pkg.packageName,
      version: pkg.version,
      registryUrl: pkg.registryUrl,
      packageIntegrity: pkg.packageIntegrity,
      tarballUrl: pkg.tarballUrl,
      model: decode(pkg.evaluatedModel) as LibraryModel,
      sourceManifest: pkg.sourceManifest,
      packageMetadata: pkg.packageMetadata,
    }))

    return {
      id: snapshot.id,
      hash: snapshot.hash,
      lockfile: snapshot.lockfile,
      model: decode(snapshot.evaluatedModel) as LibraryModel,
      sourceManifest: snapshot.sourceManifest,
      compatibility: snapshot.compatibility,
      packages,
      selectedPackages: selectedLibraryPackagesSchema.parse(
        packages.map(({ packageName, version }) => ({ packageName, version })),
      ),
    }
  }

  async commit(
    projectId: string,
    previous: ProjectLibraryState,
    content: LibrarySnapshotContent,
    hash: string,
  ): Promise<ProjectLibrarySnapshot> {
    if (snapshotHash(content) !== hash) {
      throw new Error("Library snapshot hash mismatch")
    }

    const packageSelections = selectedLibraryPackagesSchema.parse(
      content.packages.map(({ packageName, version }) => ({ packageName, version })),
    )

    if (
      canonicalJson(packageSelections) !==
      canonicalJson(selectedLibraryPackagesSchema.parse(content.selectedPackages))
    ) {
      throw new Error("Snapshot membership does not match package selections")
    }

    const database = await this.database.forProject(projectId)

    const id = await database.$transaction(async tx => {
      // fence the actual selection and desired snapshot rather than inventing a generic revision
      const state = await tx.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } })
      if (
        canonicalJson(state.selectedPackages) !== canonicalJson(previous.selectedPackages) ||
        state.desiredSnapshotId !== previous.desiredSnapshotId
      ) {
        throw new Error("Project library changed concurrently")
      }

      const cached = await tx.librarySnapshot.findUnique({ where: { hash } })
      let snapshotId = cached?.id
      if (!snapshotId) {
        const versions: string[] = []

        for (const pkg of content.packages) {
          const version = await tx.libraryPackageVersion.upsert({
            where: {
              packageName_version_packageIntegrity: {
                packageName: pkg.packageName,
                version: pkg.version,
                packageIntegrity: pkg.packageIntegrity,
              },
            },
            create: {
              packageName: pkg.packageName,
              version: pkg.version,
              registryUrl: pkg.registryUrl,
              packageIntegrity: pkg.packageIntegrity,
              tarballUrl: pkg.tarballUrl,
              evaluatedModel: encode(pkg.model),
              sourceManifest: pkg.sourceManifest,
              packageMetadata: JSON.parse(canonicalJson(pkg.packageMetadata)),
            },
            update: {},
          })

          // serialized artifacts are graph-independent; never cache live module evaluation under this key
          if (
            canonicalJson(decode(version.evaluatedModel)) !== canonicalJson(pkg.model) ||
            canonicalJson(version.sourceManifest) !== canonicalJson(pkg.sourceManifest)
          ) {
            throw new Error("Immutable package artifact changed")
          }

          versions.push(version.id)
        }

        const snapshot = await tx.librarySnapshot.create({
          data: {
            hash,
            lockfile: content.lockfile,
            evaluatedModel: encode(content.model),
            sourceManifest: content.sourceManifest,
            compatibility: content.compatibility,
            versions: {
              create: versions.map(libraryPackageVersionId => ({ libraryPackageVersionId })),
            },
          },
        })

        snapshotId = snapshot.id
      }

      const result = await tx.projectLibraryState.updateMany({
        where: {
          id: "default",
          desiredSnapshotId: previous.desiredSnapshotId,
          selectedPackages: { equals: previous.selectedPackages },
        },
        data: { selectedPackages: content.selectedPackages, desiredSnapshotId: snapshotId },
      })

      if (result.count !== 1) {
        throw new Error("Project library changed concurrently")
      }

      return snapshotId
    })

    return await this.snapshot(projectId, id)
  }

  async setOverlay(projectId: string, enabled: boolean): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.projectLibraryState.update({
      where: { id: "default" },
      data: { localOverlayEnabled: enabled },
    })
  }
}
