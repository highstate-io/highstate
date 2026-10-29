import type { ComponentModel, EntityModel } from "@highstate/contract"
import type { ProjectLibraryCatalogProvider } from "../business/project-library"
import type { DatabaseManager } from "../database"
import type { LibraryModel } from "../shared"
import type { LocalLibraryOverlaySnapshot } from "./abstractions"
import type { NpmRegistryAccess, ProjectNpmRegistryProvider } from "./npm"
import { localContainerRuntime } from "../shared"
import { npmPackageNameSchema } from "./project-types"

export interface NpmCredentialDecrypter {
  decrypt(credentialId: string, encryptedCredentials: string): Promise<{ token: string }>
}

/**
 * Restricts credential lookup to the npm credentials associated with the project's selected runtime.
 */
export class RuntimeProjectNpmRegistryProvider implements ProjectNpmRegistryProvider {
  constructor(
    private readonly database: DatabaseManager,
    private readonly credentials: NpmCredentialDecrypter,
  ) {}

  async forPackage(projectId: string, packageName: string): Promise<NpmRegistryAccess> {
    npmPackageNameSchema.parse(packageName)
    const scopes = await this.scopes(projectId)
    const scope = packageName.startsWith("@") ? packageName.split("/")[0]! : ""
    return scopes[scope] ?? scopes[""] ?? { registryUrl: "https://registry.npmjs.org/" }
  }

  async scopes(projectId: string): Promise<Record<string, NpmRegistryAccess>> {
    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { containerRuntime: { select: { npmRegistryCredentials: true } } },
    })

    const scopes: Record<string, NpmRegistryAccess> = {}

    for (const credential of project.containerRuntime.npmRegistryCredentials) {
      const { token } = await this.credentials.decrypt(
        credential.id,
        credential.encryptedCredentials,
      )

      scopes[credential.scope.replace(/\/$/, "")] = { registryUrl: credential.registryUrl, token }
    }

    return scopes
  }
}

export interface ProjectVirtualLibraryProvider {
  getVirtualComponentsCore(projectId: string): Promise<Record<string, ComponentModel>>
  getVirtualEntities(): Record<string, EntityModel>
}

export interface LocalLibraryOverlayProvider {
  loadLocalOverlay?(signal?: AbortSignal): Promise<LibraryModel>
  getLocalOverlayRevision?(): Promise<string>
  getLocalOverlaySnapshot?(): Promise<LocalLibraryOverlaySnapshot>
}

/**
 * Adapts existing virtual definitions and the host backend without ever using the host as a packaged fallback.
 */
export class RuntimeProjectLibraryCatalogProvider implements ProjectLibraryCatalogProvider {
  constructor(
    private readonly database: DatabaseManager,
    private readonly local: LocalLibraryOverlayProvider,
    private readonly virtual: ProjectVirtualLibraryProvider,
  ) {}

  async virtualModel(projectId: string) {
    return {
      components: await this.virtual.getVirtualComponentsCore(projectId),
      entities: this.virtual.getVirtualEntities(),
    }
  }

  async supportsLocalOverlay(projectId: string): Promise<boolean> {
    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { containerRuntimeId: true, containerRuntime: { select: { spec: true } } },
    })

    const spec = project.containerRuntime.spec
    return (
      project.containerRuntimeId === localContainerRuntime.id &&
      spec.type === "docker" &&
      spec.local
    )
  }

  async localOverlay(projectId: string) {
    if (!(await this.supportsLocalOverlay(projectId))) {
      throw new Error("Local overlays require the well-known local runtime")
    }

    if (!this.local.loadLocalOverlay) {
      throw new Error("The library backend does not support local overlays")
    }

    return await this.local.loadLocalOverlay()
  }

  async localOverlayRevision(projectId: string): Promise<string> {
    if (!(await this.supportsLocalOverlay(projectId))) {
      throw new Error("Local overlays require the well-known local runtime")
    }

    if (!this.local.getLocalOverlayRevision) {
      throw new Error("The library backend does not expose local source revisions")
    }

    return await this.local.getLocalOverlayRevision()
  }

  async localOverlaySnapshot(projectId: string): Promise<LocalLibraryOverlaySnapshot> {
    if (!(await this.supportsLocalOverlay(projectId))) {
      throw new Error("Local overlays require the well-known local runtime")
    }

    if (!this.local.getLocalOverlaySnapshot) {
      throw new Error("The library backend does not support atomic local overlay snapshots")
    }

    return await this.local.getLocalOverlaySnapshot()
  }
}
