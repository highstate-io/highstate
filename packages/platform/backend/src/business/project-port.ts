import type { DatabaseManager } from "../database"
import type { LibraryModel, ResolvedInstanceInput } from "../shared"
import type { ProjectUnlockBackend } from "../unlock"
import type { CapturedEntitySnapshotValue, OutputExportedSnapshotGraph } from "./entity-snapshot"
import type { UnitEntitySnapshotPayload } from "./unit-output"
import { crc32 } from "node:zlib"
import {
  type ComponentInput,
  getEntityId,
  type InstanceId,
  type InstanceModel,
  type VersionedName,
} from "@highstate/contract"
import { sha256 } from "@noble/hashes/sha2"
import { armor, Decrypter, Encrypter } from "age-encryption"
import { SYSTEM_EXPORT_COMPONENT_TYPE, stableJsonStringify } from "../shared"
import { type ProjectImportPortData, projectImportPortDataSchema } from "../shared/models/import"

type BuildExportPayloadFromSnapshotsOptions = {
  projectName: string
  instance: InstanceModel
  resolvedInputs: Record<string, ResolvedInstanceInput[]>
  library: LibraryModel
  tryGetInstance: (instanceId: InstanceId) => InstanceModel | undefined
  tryGetStateId: (instanceId: InstanceId) => string | undefined
  getExportedOutputGraph: (stateId: string, output: string) => Promise<OutputExportedSnapshotGraph>
}

type ExportedEntityMeta = {
  title?: string
  description?: string
  icon?: string
  iconColor?: string
}

type InclusionReference = {
  fromId: string
  toId: string
  kind: "inclusion"
  group: string
}

type ExportedEntityAccumulator = {
  type: string
  identity: string
  referencedInOutputs: Set<string>
  exportedInOutputs: Set<string>
  meta: ExportedEntityMeta
  content: unknown
}

type SyncExportPortOptions = {
  projectId: string
  sourceStateId: string
  targetProjectNames: string[]
  payload: ProjectImportPortData
}

type PayloadEncryptionResult = {
  contentHash: string
  content: string
}

type ImportEntityAccumulator = {
  type: VersionedName
  identity: string
  referencedInOutputs: Set<string>
  exportedInOutputs: Set<string>
  meta: ExportedEntityMeta
  content: Record<string, unknown>
}

type NormalizeImportEntityGraphResult = {
  entitiesById: Map<string, ImportEntityAccumulator>
  referencesByKey: Map<string, InclusionReference>
}

export class ProjectPortService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly encryptionEnabled = true,
    private readonly projectUnlockBackend?: ProjectUnlockBackend,
  ) {}

  isExportPortType(instanceType: string): boolean {
    return instanceType === SYSTEM_EXPORT_COMPONENT_TYPE
  }

  isImportPortType(instanceType: string): boolean {
    return instanceType.startsWith("system.import.") && instanceType.endsWith(".v1")
  }

  extractImportSourceStateId(instanceType: string): string | null {
    if (!this.isImportPortType(instanceType)) {
      return null
    }

    return instanceType.slice("system.import.".length, -".v1".length)
  }

  async buildExportPayloadFromSnapshots(
    options: BuildExportPayloadFromSnapshotsOptions,
  ): Promise<ProjectImportPortData> {
    const outputs: Record<string, ComponentInput> = {}
    const referencesByKey = new Map<string, InclusionReference>()
    const entitiesById = new Map<string, ExportedEntityAccumulator>()

    const resolveExportOutputNames = (
      fallbackOutputName: string,
      resolvedInput: ResolvedInstanceInput,
    ): string[] => {
      const matches = Object.entries(options.instance.inputs ?? {})
        .filter(([, inputs]) =>
          inputs.some(
            input =>
              input.instanceId === resolvedInput.input.instanceId &&
              input.output === resolvedInput.input.output &&
              input.path === resolvedInput.input.path,
          ),
        )
        .map(([name]) => name)

      return matches.length > 0 ? matches : [fallbackOutputName]
    }

    for (const [outputName, inputGroup] of Object.entries(options.resolvedInputs)) {
      for (const resolvedInput of inputGroup) {
        const dependency = options.tryGetInstance(resolvedInput.input.instanceId)
        if (!dependency) {
          continue
        }

        const exportOutputNames = resolveExportOutputNames(outputName, resolvedInput)

        const dependencyComponent = options.library.components[dependency.type]
        const outputSpec = dependencyComponent?.outputs?.[resolvedInput.input.output]

        if (outputSpec) {
          const normalizedOutputType = resolvedInput.type as VersionedName

          const normalizedOutputSpec: ComponentInput = {
            ...outputSpec,
            // always use resolved effective output type to preserve forwarded/path-derived entity types.
            type: normalizedOutputType,
            // import virtual components have no inputs to forward from.
            fromInput: undefined,
          }

          for (const exportOutputName of exportOutputNames) {
            if (!outputs[exportOutputName]) {
              outputs[exportOutputName] = normalizedOutputSpec
            }
          }
        }

        const dependencyStateId = options.tryGetStateId(resolvedInput.input.instanceId)
        if (!dependencyStateId) {
          continue
        }

        const graph = await options.getExportedOutputGraph(
          dependencyStateId,
          resolvedInput.input.output,
        )

        const exportedEntityIds = new Set(graph.rootEntityIds)

        for (const entity of graph.entities) {
          const existing = entitiesById.get(entity.entityId)

          if (existing) {
            for (const exportOutputName of exportOutputNames) {
              existing.referencedInOutputs.add(exportOutputName)
              if (exportedEntityIds.has(entity.entityId)) {
                existing.exportedInOutputs.add(exportOutputName)
              }
            }
            continue
          }

          const referencedInOutputs = new Set<string>()
          const exportedInOutputs = new Set<string>()

          for (const exportOutputName of exportOutputNames) {
            referencedInOutputs.add(exportOutputName)
            if (exportedEntityIds.has(entity.entityId)) {
              exportedInOutputs.add(exportOutputName)
            }
          }

          entitiesById.set(entity.entityId, {
            type: entity.type,
            identity: entity.identity,
            referencedInOutputs,
            exportedInOutputs,
            meta: {
              ...(typeof entity.meta.title === "string" ? { title: entity.meta.title } : {}),
              ...(typeof entity.meta.description === "string"
                ? { description: entity.meta.description }
                : {}),
              ...(typeof entity.meta.icon === "string" ? { icon: entity.meta.icon } : {}),
              ...(typeof entity.meta.iconColor === "string"
                ? { iconColor: entity.meta.iconColor }
                : {}),
            },
            content: { ...entity.content },
          })
        }

        for (const reference of graph.references) {
          referencesByKey.set(
            `${reference.fromEntityId}:${reference.toEntityId}:${reference.group}`,
            {
              fromId: reference.fromEntityId,
              toId: reference.toEntityId,
              kind: "inclusion",
              group: reference.group,
            },
          )
        }
      }
    }

    return {
      meta: {
        title: `${options.projectName}/${options.instance.name}`,
      },
      outputs,
      entities: Array.from(entitiesById.values()).map(entity => ({
        type: entity.type,
        identity: entity.identity,
        referencedInOutputs: Array.from(entity.referencedInOutputs),
        exportedInOutputs: Array.from(entity.exportedInOutputs),
        meta: entity.meta,
        content: entity.content,
      })),
      references: Array.from(referencesByKey.values()),
    }
  }

  /**
   * Persists the current export-port payload for all selected destination projects.
   *
   * Existing rows for this source state that are not in selected targets are removed.
   *
   * @param projectId The source project ID.
   * @param sourceStateId The source export-port state ID.
   * @param targetProjectNames Destination project names selected in export-port args.
   * @param payload The export payload to encrypt and distribute.
   */
  async syncExportPort(options: SyncExportPortOptions): Promise<void> {
    const payload = projectImportPortDataSchema.parse(options.payload)

    const targetNames = Array.from(
      new Set(
        options.targetProjectNames
          .filter(name => typeof name === "string")
          .map(name => name.trim())
          .filter(name => name.length > 0),
      ),
    )

    if (targetNames.length === 0) {
      await this.database.backend.projectImportPort.deleteMany({
        where: {
          sourceProjectId: options.projectId,
          sourceStateId: options.sourceStateId,
        },
      })
      return
    }

    const targets = await this.database.backend.project.findMany({
      where: {
        id: { not: options.projectId },
        name: { in: targetNames },
        ...(this.encryptionEnabled ? { publicKey: { not: null } } : {}),
      },
      select: {
        id: true,
        publicKey: true,
      },
    })

    const selectedTargetIds = targets.map(target => target.id)

    await this.database.backend.$transaction(async tx => {
      for (const target of targets) {
        const { contentHash, content } = this.encryptionEnabled
          ? await this.encryptPayload(payload, target.publicKey)
          : this.createPlainPayload(payload)

        await tx.projectImportPort.upsert({
          where: {
            projectId_sourceStateId: {
              projectId: target.id,
              sourceStateId: options.sourceStateId,
            },
          },
          create: {
            projectId: target.id,
            sourceProjectId: options.projectId,
            sourceStateId: options.sourceStateId,
            contentHash,
            encryptedContent: content,
          },
          update: {
            sourceProjectId: options.projectId,
            contentHash,
            encryptedContent: content,
          },
        })
      }

      await tx.projectImportPort.deleteMany({
        where: {
          sourceProjectId: options.projectId,
          sourceStateId: options.sourceStateId,
          projectId: {
            notIn: selectedTargetIds,
          },
        },
      })
    })
  }

  /**
   * Removes all import-port rows produced by an export port.
   *
   * @param projectId The source project ID.
   * @param sourceStateId The source export-port state ID.
   */
  async clearExportPort(projectId: string, sourceStateId: string): Promise<void> {
    await this.database.backend.projectImportPort.deleteMany({
      where: {
        sourceProjectId: projectId,
        sourceStateId,
      },
    })
  }

  /**
   * Reads the latest content hash for a concrete import port instance.
   *
   * @param projectId The target project ID.
   * @param sourceStateId The paired source export-port state ID.
   * @returns The persisted content hash if available.
   */
  async getImportPortContentHash(projectId: string, sourceStateId: string): Promise<number | null> {
    const row = await this.database.backend.projectImportPort.findFirst({
      where: {
        projectId,
        sourceStateId,
      },
      select: {
        contentHash: true,
      },
    })

    if (!row) {
      return null
    }

    return crc32(row.contentHash)
  }

  /**
   * Reads and parses import-port payload for a target project and source state ID.
   *
   * Returns null when row is missing or payload cannot be decrypted/parsed.
   *
   * @param projectId The target project ID.
   * @param sourceStateId The paired source export-port state ID.
   */
  async getImportPortPayload(
    projectId: string,
    sourceStateId: string,
  ): Promise<ProjectImportPortData | null> {
    const row = await this.database.backend.projectImportPort.findFirst({
      where: {
        projectId,
        sourceStateId,
      },
      select: {
        encryptedContent: true,
      },
    })

    if (!row) {
      return null
    }

    const privateKey = this.projectUnlockBackend
      ? await this.projectUnlockBackend.getProjectPrivateKey(projectId)
      : null

    const payloadContent = await this.tryDecryptImportPayload(row.encryptedContent, privateKey)
    if (!payloadContent) {
      return null
    }

    try {
      return projectImportPortDataSchema.parse(JSON.parse(payloadContent))
    } catch {
      return null
    }
  }

  /**
   * Builds runtime captured output values from import-port payload entities.
   *
   * @param payload The parsed import-port payload.
   */
  buildImportCapturedOutputValues(
    payload: ProjectImportPortData,
  ): Record<string, CapturedEntitySnapshotValue[]> {
    const valuesByOutput: Record<string, CapturedEntitySnapshotValue[]> = {}

    for (const outputName of Object.keys(payload.outputs)) {
      valuesByOutput[outputName] = []
    }

    for (const entity of payload.entities) {
      for (const outputName of entity.exportedInOutputs) {
        let list = valuesByOutput[outputName]
        if (!list) {
          list = []
          valuesByOutput[outputName] = list
        }

        if (
          typeof entity.content !== "object" ||
          entity.content === null ||
          Array.isArray(entity.content)
        ) {
          list.push({
            ok: false,
            error: {
              message: `Imported entity content is not an object for "${entity.type}:${entity.identity}"`,
              snapshotId: `${entity.type}:${entity.identity}`,
              entityType: entity.type as VersionedName,
              entityIdentity: entity.identity,
            },
          })
          continue
        }

        const meta: Record<string, unknown> = {
          type: entity.type,
          identity: entity.identity,
          ...(typeof entity.meta.title === "string" ? { title: entity.meta.title } : {}),
          ...(typeof entity.meta.description === "string"
            ? { description: entity.meta.description }
            : {}),
          ...(typeof entity.meta.icon === "string" ? { icon: entity.meta.icon } : {}),
          ...(typeof entity.meta.iconColor === "string"
            ? { iconColor: entity.meta.iconColor }
            : {}),
        }

        list.push({
          ok: true,
          value: {
            ...(entity.content as Record<string, unknown>),
            $meta: meta,
          },
        })
      }
    }

    return valuesByOutput
  }

  /**
   * Converts import-port payload entities into a normalized snapshot payload.
   *
   * @param payload The parsed import-port payload.
   */
  buildImportEntitySnapshotPayload(payload: ProjectImportPortData): UnitEntitySnapshotPayload {
    const normalized = this.normalizeImportEntityGraph(payload)
    const nodes: UnitEntitySnapshotPayload["nodes"] = []

    for (const [entityId, entity] of normalized.entitiesById) {
      nodes.push({
        entityId,
        entityType: entity.type,
        identity: entity.identity,
        meta: entity.meta,
        content: entity.content,
        referencedOutputs: Array.from(entity.referencedInOutputs),
        exportedOutputs: Array.from(entity.exportedInOutputs),
      })
    }

    const nodeIdSet = new Set(nodes.map(node => node.entityId))

    const explicitReferences = payload.references
      .filter(reference => reference.kind === "explicit")
      .filter(reference => nodeIdSet.has(reference.fromId) && nodeIdSet.has(reference.toId))
      .map(reference => ({
        fromEntityId: reference.fromId,
        toEntityId: reference.toId,
        group: reference.group,
      }))

    const implicitReferences = Array.from(normalized.referencesByKey.values())
      .filter(reference => nodeIdSet.has(reference.fromId) && nodeIdSet.has(reference.toId))
      .map(reference => ({
        fromEntityId: reference.fromId,
        toEntityId: reference.toId,
        group: reference.group,
      }))

    return {
      nodes,
      explicitReferences,
      implicitReferences,
    }
  }

  private normalizeImportEntityGraph(
    payload: ProjectImportPortData,
  ): NormalizeImportEntityGraphResult {
    const entitiesById = new Map<string, ImportEntityAccumulator>()
    const referencesByKey = new Map<string, InclusionReference>()

    for (const reference of payload.references) {
      if (reference.kind !== "inclusion") {
        continue
      }

      referencesByKey.set(`${reference.fromId}:${reference.toId}:${reference.group}`, {
        fromId: reference.fromId,
        toId: reference.toId,
        kind: "inclusion",
        group: reference.group,
      })
    }

    for (const entity of payload.entities) {
      if (
        typeof entity.content !== "object" ||
        entity.content === null ||
        Array.isArray(entity.content)
      ) {
        continue
      }

      const entityId = getEntityId({
        $meta: {
          type: entity.type as VersionedName,
          identity: entity.identity,
        },
      })

      const existing = entitiesById.get(entityId)
      if (existing) {
        for (const output of entity.referencedInOutputs) {
          existing.referencedInOutputs.add(output)
        }
        for (const output of entity.exportedInOutputs) {
          existing.exportedInOutputs.add(output)
        }

        existing.meta = {
          ...existing.meta,
          ...(typeof entity.meta.title === "string" ? { title: entity.meta.title } : {}),
          ...(typeof entity.meta.description === "string"
            ? { description: entity.meta.description }
            : {}),
          ...(typeof entity.meta.icon === "string" ? { icon: entity.meta.icon } : {}),
          ...(typeof entity.meta.iconColor === "string"
            ? { iconColor: entity.meta.iconColor }
            : {}),
        }

        continue
      }

      entitiesById.set(entityId, {
        type: entity.type as VersionedName,
        identity: entity.identity,
        referencedInOutputs: new Set(entity.referencedInOutputs),
        exportedInOutputs: new Set(entity.exportedInOutputs),
        meta: {
          ...(typeof entity.meta.title === "string" ? { title: entity.meta.title } : {}),
          ...(typeof entity.meta.description === "string"
            ? { description: entity.meta.description }
            : {}),
          ...(typeof entity.meta.icon === "string" ? { icon: entity.meta.icon } : {}),
          ...(typeof entity.meta.iconColor === "string"
            ? { iconColor: entity.meta.iconColor }
            : {}),
        },
        content: { ...(entity.content as Record<string, unknown>) },
      })
    }

    return {
      entitiesById,
      referencesByKey,
    }
  }

  private async encryptPayload(
    payload: ProjectImportPortData,
    recipient: string | null,
  ): Promise<PayloadEncryptionResult> {
    if (!recipient) {
      throw new Error("Recipient public key is required when encryption is enabled")
    }

    const content = stableJsonStringify(payload)

    const encrypter = new Encrypter()
    encrypter.addRecipient(recipient)

    const encryptedContent = await encrypter.encrypt(content)
    const contentHash = Buffer.from(sha256(encryptedContent)).toString("hex")
    const armoredContent = armor.encode(encryptedContent)

    return {
      contentHash,
      content: armoredContent,
    }
  }

  private createPlainPayload(payload: ProjectImportPortData): PayloadEncryptionResult {
    const content = stableJsonStringify(payload)

    return {
      contentHash: Buffer.from(sha256(Buffer.from(content))).toString("hex"),
      content,
    }
  }

  private async tryDecryptImportPayload(
    encryptedContent: string,
    privateKey: string | null,
  ): Promise<string | null> {
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
    } catch {
      return null
    }
  }
}
