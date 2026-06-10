import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { LibraryBackend, ResolvedUnitSource } from "../library"
import type { ProjectUnlockBackend } from "../unlock"
import {
  type ComponentInput,
  type ComponentModel,
  type EntityModel,
  objectEntity,
} from "@highstate/contract"
import { armor, Decrypter } from "age-encryption"
import { type LibraryModel, SYSTEM_EXPORT_COMPONENT_TYPE } from "../shared"
import { projectImportPortDataSchema } from "../shared/models/import"

type ProjectRow = {
  id: string
  name: string
  publicKey: string | null
}

type ImportPortRow = {
  sourceStateId: string
  encryptedContent: string
}

export class LibraryService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly libraryBackend: LibraryBackend,
    private readonly projectUnlockBackend: ProjectUnlockBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns project-specific virtual components.
   *
   * This currently includes:
   * - `SYSTEM_EXPORT_COMPONENT_TYPE`
   * - `system.import.${sourceStateId}.v1` for rows present in `ProjectImportPort`.
   */
  async getVirtualComponents(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, ComponentModel>> {
    signal?.throwIfAborted()

    const [targetProjects, importPorts] = await Promise.all([
      this.getExportTargets(projectId),
      this.getImportPorts(projectId),
    ])
    const privateKey = await this.projectUnlockBackend.getProjectPrivateKey(projectId)

    const components: Record<string, ComponentModel> = {}

    const exportComponent = this.createExportComponent(targetProjects.map(project => project.name))

    components[exportComponent.type] = exportComponent

    for (const importPort of importPorts) {
      const importComponent = await this.createImportComponent(importPort, privateKey)
      components[importComponent.type] = importComponent
    }

    return components
  }

  async getResolvedUnitSources(
    libraryId: string,
    unitTypes: string[],
  ): Promise<ResolvedUnitSource[]> {
    return await this.libraryBackend.getResolvedUnitSources(libraryId, unitTypes)
  }

  /**
   * Returns a project-scoped library model where virtual components overlay global components.
   *
   * It avoids copying full global model maps by using proxies for component and entity access.
   */
  async getLibraryModel(projectId: string, signal?: AbortSignal): Promise<LibraryModel> {
    const [project, baseLibrary, virtualComponents] = await Promise.all([
      this.database.backend.project.findUnique({
        where: { id: projectId },
        select: { libraryId: true },
      }),
      this.database.backend.project
        .findUnique({ where: { id: projectId }, select: { libraryId: true } })
        .then(async value => {
          if (!value) {
            throw new Error(`Project "${projectId}" not found`)
          }

          return await this.libraryBackend.loadLibrary(value.libraryId, signal)
        }),
      this.getVirtualComponents(projectId, signal),
    ])
    const virtualEntities = this.getVirtualEntities()

    if (!project) {
      throw new Error(`Project "${projectId}" not found`)
    }

    const proxiedComponents = new Proxy(baseLibrary.components, {
      get(target, property, receiver) {
        if (typeof property === "string" && property in virtualComponents) {
          return virtualComponents[property]
        }

        return Reflect.get(target, property, receiver)
      },
      has(target, property) {
        if (typeof property === "string" && property in virtualComponents) {
          return true
        }

        return Reflect.has(target, property)
      },
      ownKeys(target) {
        const globalKeys = Reflect.ownKeys(target)
        const virtualKeys = Object.keys(virtualComponents)

        return Array.from(new Set([...globalKeys, ...virtualKeys]))
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && property in virtualComponents) {
          return {
            configurable: true,
            enumerable: true,
            writable: false,
            value: virtualComponents[property],
          }
        }

        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    }) as Record<string, ComponentModel>

    const proxiedEntities = new Proxy(baseLibrary.entities, {
      get(target, property, receiver) {
        if (typeof property === "string" && property in virtualEntities) {
          return virtualEntities[property]
        }

        return Reflect.get(target, property, receiver)
      },
      has(target, property) {
        if (typeof property === "string" && property in virtualEntities) {
          return true
        }

        return Reflect.has(target, property)
      },
      ownKeys(target) {
        const globalKeys = Reflect.ownKeys(target)
        const virtualKeys = Object.keys(virtualEntities)

        return Array.from(new Set([...globalKeys, ...virtualKeys]))
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && property in virtualEntities) {
          return {
            configurable: true,
            enumerable: true,
            writable: false,
            value: virtualEntities[property],
          }
        }

        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    }) as Record<string, EntityModel>

    return {
      components: proxiedComponents,
      entities: proxiedEntities,
    }
  }

  private getVirtualEntities(): Record<string, EntityModel> {
    return {
      [objectEntity.model.type]: objectEntity.model,
    }
  }

  private async getExportTargets(projectId: string): Promise<ProjectRow[]> {
    return await this.database.backend.project.findMany({
      where: {
        id: { not: projectId },
        publicKey: { not: null },
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
      },
    })
  }

  private async getImportPorts(projectId: string): Promise<ImportPortRow[]> {
    try {
      const rows = await this.database.backend.projectImportPort.findMany({
        where: {
          projectId,
        },
        select: {
          sourceStateId: true,
          encryptedContent: true,
        },
      })

      return rows.map(row => ({
        sourceStateId: row.sourceStateId,
        encryptedContent: row.encryptedContent,
      }))
    } catch (error) {
      this.logger.debug(
        { error, projectId },
        "project import ports table is not available while resolving virtual components",
      )

      return []
    }
  }

  private createExportComponent(targetProjectNames: string[]): ComponentModel {
    const projectsArg = {
      schema: {
        type: "array",
        title: "Projects",
        items: {
          type: "string",
          enum: targetProjectNames,
        },
        uniqueItems: true,
      } as never,
      required: false,
      meta: {
        title: "Projects",
        description: "Destination projects that will receive entities exported from this port.",
      },
    }

    const model: ComponentModel = {
      type: SYSTEM_EXPORT_COMPONENT_TYPE,
      kind: "unit",
      args: {
        projects: projectsArg,
      },
      inputs: {},
      outputs: {},
      meta: {
        title: "Export Port",
        description: "Shares selected outputs to other projects.",
        category: "system",
        icon: "mdi:export",
        defaultNamePrefix: "port",
      },
      definitionHash: 0,
    }

    model.definitionHash = 0

    return model
  }

  private async createImportComponent(
    importPort: ImportPortRow,
    privateKey: string | null,
  ): Promise<ComponentModel> {
    const parsedPayload = await this.tryParseImportPayload(importPort.encryptedContent, privateKey)

    const model: ComponentModel = {
      type: `system.import.${importPort.sourceStateId}.v1`,
      kind: "unit",
      args: {},
      inputs: {},
      outputs: parsedPayload?.outputs ?? {},
      meta: {
        title: parsedPayload?.meta.title ?? importPort.sourceStateId,
        description: "Reads entities exported from another project",
        category: "system",
        icon: "mdi:import",
        defaultNamePrefix: "port",
      },
      definitionHash: 0,
    }

    model.definitionHash = 0

    return model
  }

  private async tryParseImportPayload(
    encryptedContent: string,
    privateKey: string | null,
  ): Promise<{
    meta: { title: string; description?: string; icon?: string; iconColor?: string }
    outputs: Record<string, ComponentInput>
  } | null> {
    const payloadContent = await this.tryDecryptImportPayload(encryptedContent, privateKey)
    if (!payloadContent) {
      return null
    }
    try {
      const payload = projectImportPortDataSchema.parse(JSON.parse(payloadContent))

      return {
        meta: payload.meta,
        outputs: payload.outputs,
      }
    } catch (error) {
      this.logger.debug({ error }, "failed to parse project import port payload for virtual model")
      return null
    }
  }

  private async tryDecryptImportPayload(
    encryptedContent: string,
    privateKey: string | null,
  ): Promise<string | null> {
    // development mode path: import payload can be stored as unencrypted JSON instead of AGE-armored content
    if (encryptedContent.trim().startsWith("{")) {
      return encryptedContent
    }

    if (!privateKey) {
      return null
    }

    try {
      const decrypter = new Decrypter()
      decrypter.addIdentity(privateKey)

      const encryptedBuffer = armor.decode(encryptedContent)

      return await decrypter.decrypt(encryptedBuffer, "text")
    } catch (error) {
      this.logger.debug(
        { error },
        "failed to decrypt project import port payload for virtual model",
      )
      return null
    }
  }
}
