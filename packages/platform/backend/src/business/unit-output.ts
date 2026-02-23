import type {
  EntityWithMeta,
  InstanceStatusField,
  UnitPage,
  UnitTerminal,
  UnitTrigger,
  UnitWorker,
  VersionedName,
} from "@highstate/contract"
import {
  instanceStatusFieldSchema,
  unitArtifactId,
  unitArtifactSchema,
  unitPageSchema,
  unitTerminalSchema,
  unitTriggerSchema,
  unitWorkerSchema,
} from "@highstate/contract"
import { getEntityId } from "@highstate/contract"
import { encode } from "@msgpack/msgpack"
import { sha256 } from "@noble/hashes/sha2"
import { crc32 } from "node:zlib"
import type { Logger } from "pino"
import { mapValues, omitBy } from "remeda"
import { z } from "zod"
import type { LibraryBackend } from "../library"

export type RawPulumiOutputValue = {
  value: unknown
  secret?: boolean
}

export type RawPulumiOutputs = Record<string, RawPulumiOutputValue>

export type UnitEntitySnapshotPayload = {
  nodes: UnitEntitySnapshotNode[]
  implicitReferences: UnitEntitySnapshotReference[]
  explicitReferences: UnitEntitySnapshotReference[]
}

export type UnitEntitySnapshotNode = {
  entityId: string
  entityType: VersionedName
  identity: string
  meta: {
    title?: string
    description?: string
    icon?: string
    iconColor?: string
  } | null
  content: Record<string, unknown>
  referencedOutputs: string[]
  exportedOutputs: string[]
}

export type UnitEntitySnapshotReference = {
  fromEntityId: string
  toEntityId: string
  group: string
}

export type ParsedUnitOutputs = {
  outputHash: number | null
  statusFields: InstanceStatusField[] | null
  terminals: UnitTerminal[] | null
  pages: UnitPage[] | null
  triggers: UnitTrigger[] | null
  secrets: Record<string, unknown> | null
  workers: UnitWorker[] | null
  exportedArtifactIds: Record<string, string[]> | null
  entitySnapshotError: string | null
  entitySnapshotPayload: UnitEntitySnapshotPayload | null
}

export class UnitOutputService {
  constructor(
    private readonly libraryBackend: LibraryBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Parses raw Pulumi outputs returned by the runner.
   *
   * It extracts Highstate-specific "$..." outputs, computes output hash,
   * and builds entity snapshot payload based on static component/entity models.
   *
   * @param options The raw parsing inputs.
   */
  async parseUnitOutputs(options: {
    libraryId: string
    instanceType: VersionedName
    outputs: RawPulumiOutputs
    signal?: AbortSignal
  }): Promise<ParsedUnitOutputs> {
    const unitOutputs = omitBy(options.outputs, (_value, key) => key.startsWith("$"))
    const outputNames = Object.keys(unitOutputs)

    const outputHash = outputNames.length > 0 ? crc32(sha256(encode(unitOutputs))) : null

    const statusFields = options.outputs["$statusFields"]
      ? z.array(instanceStatusFieldSchema).parse(options.outputs["$statusFields"].value)
      : null

    const terminals = options.outputs["$terminals"]
      ? z.array(unitTerminalSchema).parse(options.outputs["$terminals"].value)
      : null

    const pages = options.outputs["$pages"]
      ? z.array(unitPageSchema).parse(options.outputs["$pages"].value)
      : null

    const triggers = options.outputs["$triggers"]
      ? z.array(unitTriggerSchema).parse(options.outputs["$triggers"].value)
      : null

    const workers = options.outputs["$workers"]
      ? z.array(unitWorkerSchema).parse(options.outputs["$workers"].value)
      : null

    const secrets = options.outputs["$secrets"]
      ? z.record(z.string(), z.unknown()).parse(options.outputs["$secrets"].value)
      : null

    const exportedArtifactIds = this.parseExportedArtifactIds(options.outputs)

    let entitySnapshotPayload: UnitEntitySnapshotPayload | null = null
    let entitySnapshotError: string | null = null

    try {
      entitySnapshotPayload = await this.parseEntitySnapshotPayload({
        libraryId: options.libraryId,
        instanceType: options.instanceType,
        unitOutputs,
        signal: options.signal,
      })
    } catch (error) {
      entitySnapshotError = error instanceof Error ? error.message : String(error)
      entitySnapshotPayload = null
    }

    return {
      outputHash,
      statusFields,
      terminals,
      pages,
      triggers,
      secrets,
      workers,
      exportedArtifactIds,
      entitySnapshotError,
      entitySnapshotPayload,
    }
  }

  private parseExportedArtifactIds(outputs: RawPulumiOutputs): Record<string, string[]> | null {
    const rawArtifacts = outputs["$artifacts"]
    if (!rawArtifacts) {
      return null
    }

    const rawArtifactsByOutput = z
      .record(z.string(), z.array(z.unknown()))
      .parse(rawArtifacts.value)

    return mapValues(rawArtifactsByOutput, artifacts => {
      return artifacts.map(rawArtifact => {
        if (typeof rawArtifact !== "object" || rawArtifact === null) {
          throw new Error("Invalid artifact value")
        }

        const validated = unitArtifactSchema.parse(rawArtifact)
        const id = (rawArtifact as Record<string | symbol, unknown>)[unitArtifactId]
        if (typeof id === "string" && id.length > 0) {
          return id
        }

        throw new Error(`Failed to determine artifact ID for artifact with hash ${validated.hash}`)
      })
    })
  }

  private async parseEntitySnapshotPayload(options: {
    libraryId: string
    instanceType: VersionedName
    unitOutputs: RawPulumiOutputs
    signal?: AbortSignal
  }): Promise<UnitEntitySnapshotPayload | null> {
    const unitOutputNames = Object.keys(options.unitOutputs)
    if (unitOutputNames.length === 0) {
      return null
    }

    const library = await this.libraryBackend.loadLibrary(options.libraryId, options.signal)
    const component = library.components[options.instanceType]

    if (!component) {
      throw new Error(`Component "${options.instanceType}" is not defined in the library`)
    }

    const nodeByEntityId = new Map<
      string,
      {
        node: Omit<UnitEntitySnapshotNode, "exportedOutputs" | "referencedOutputs"> & {
          exportedOutputs: Set<string>
          referencedOutputs: Set<string>
        }
        entityModelInclusions: Array<{
          type: VersionedName
          required: boolean
          multiple: boolean
          field: string
        }>
      }
    >()

    const implicitReferencesByKey = new Map<string, UnitEntitySnapshotReference>()
    const explicitReferencesByKey = new Map<string, UnitEntitySnapshotReference>()

    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return typeof value === "object" && value !== null && !Array.isArray(value)
    }

    function assertEntityWithMeta(
      expectedType: VersionedName,
      output: string,
      value: unknown,
    ): asserts value is EntityWithMeta {
      if (!isRecord(value)) {
        throw new Error(`Output "${output}" must be an object`)
      }

      const meta = (value as Record<string, unknown>)["$meta"]
      if (!isRecord(meta)) {
        throw new Error(`Output "${output}" must include a "$meta" object`)
      }

      const metaType = meta["type"]
      if (metaType !== expectedType) {
        throw new Error(
          `Output "${output}" has invalid "$meta.type": expected "${expectedType}", got "${String(metaType)}"`,
        )
      }

      const metaIdentity = meta["identity"]
      if (typeof metaIdentity !== "string" || metaIdentity.length === 0) {
        throw new Error(
          `Output "${output}" has invalid "$meta.identity": expected a non-empty string`,
        )
      }
    }

    const normalizeSnapshotContent = (
      entityType: VersionedName,
      record: Record<string, unknown>,
    ): Record<string, unknown> => {
      const entityModel = library.entities[entityType]
      if (!entityModel) {
        throw new Error(`Entity type "${entityType}" is not defined in the library`)
      }

      const { $meta: _ignoredMeta, ...content } = record
      for (const inclusion of entityModel.inclusions ?? []) {
        delete (content as Record<string, unknown>)[inclusion.field]
      }

      return content
    }

    const collectEntityValue = async (options: {
      expectedType: VersionedName
      output: string
      value: unknown
      relation: "exported" | "referenced"
      stack: string[]
    }): Promise<string> => {
      assertEntityWithMeta(options.expectedType, options.output, options.value)

      const record = options.value as unknown as Record<string, unknown>

      const entityWithMeta = options.value as EntityWithMeta
      const { identity } = entityWithMeta.$meta
      const meta = entityWithMeta.$meta

      const entityId = getEntityId(entityWithMeta)
      if (options.stack.includes(entityId)) {
        throw new Error(
          `Detected entity inclusion cycle while collecting output "${options.output}": "${entityId}"`,
        )
      }

      const existing = nodeByEntityId.get(entityId)
      if (!existing) {
        const entityModel = library.entities[options.expectedType]
        if (!entityModel) {
          throw new Error(`Entity type "${options.expectedType}" is not defined in the library`)
        }

        const normalizedContent = normalizeSnapshotContent(options.expectedType, record)

        const snapshotMeta = {
          ...(typeof meta.title === "string" ? { title: meta.title } : {}),
          ...(typeof meta.description === "string" ? { description: meta.description } : {}),
          ...(typeof meta.icon === "string" ? { icon: meta.icon } : {}),
          ...(typeof meta.iconColor === "string" ? { iconColor: meta.iconColor } : {}),
        }

        nodeByEntityId.set(entityId, {
          node: {
            entityId,
            entityType: options.expectedType,
            identity,
            meta: Object.keys(snapshotMeta).length > 0 ? snapshotMeta : null,
            content: normalizedContent,
            referencedOutputs: new Set<string>(),
            exportedOutputs: new Set<string>(),
          },
          entityModelInclusions: (entityModel.inclusions ?? []).map(i => ({
            type: i.type,
            required: i.required,
            multiple: i.multiple,
            field: i.field,
          })),
        })
      }

      const current = nodeByEntityId.get(entityId)!
      if (options.relation === "exported") {
        current.node.exportedOutputs.add(options.output)
      } else {
        current.node.referencedOutputs.add(options.output)
      }

      const rawReferences = meta.references
      if (rawReferences) {
        for (const [group, ids] of Object.entries(rawReferences)) {
          for (const id of ids) {
            explicitReferencesByKey.set(`${entityId}:${id}:${group}`, {
              fromEntityId: entityId,
              toEntityId: id,
              group,
            })
          }
        }
      }

      for (const inclusion of current.entityModelInclusions) {
        const rawIncluded = record[inclusion.field]
        if (rawIncluded === undefined || rawIncluded === null) {
          continue
        }

        if (inclusion.multiple) {
          for (const item of rawIncluded as unknown[]) {
            const childEntityId = await collectEntityValue({
              expectedType: inclusion.type,
              output: options.output,
              value: item,
              relation: "referenced",
              stack: [...options.stack, entityId],
            })

            implicitReferencesByKey.set(`${entityId}:${childEntityId}:${inclusion.field}`, {
              fromEntityId: entityId,
              toEntityId: childEntityId,
              group: inclusion.field,
            })
          }
        } else {
          const childEntityId = await collectEntityValue({
            expectedType: inclusion.type,
            output: options.output,
            value: rawIncluded,
            relation: "referenced",
            stack: [...options.stack, entityId],
          })

          implicitReferencesByKey.set(`${entityId}:${childEntityId}:${inclusion.field}`, {
            fromEntityId: entityId,
            toEntityId: childEntityId,
            group: inclusion.field,
          })
        }
      }

      return entityId
    }

    for (const outputName of unitOutputNames) {
      const outputSpec = component.outputs[outputName]
      if (!outputSpec) {
        throw new Error(`Output "${outputName}" is not defined on component "${component.type}"`)
      }

      const outputValue = options.unitOutputs[outputName]?.value
      if (outputValue === undefined || outputValue === null) {
        continue
      }

      if (outputSpec.multiple) {
        if (!Array.isArray(outputValue)) {
          throw new Error(`Output "${outputName}" must be an array`)
        }

        for (const item of outputValue) {
          await collectEntityValue({
            expectedType: outputSpec.type,
            output: outputName,
            value: item,
            relation: "exported",
            stack: [],
          })
        }
      } else {
        await collectEntityValue({
          expectedType: outputSpec.type,
          output: outputName,
          value: outputValue,
          relation: "exported",
          stack: [],
        })
      }
    }

    if (nodeByEntityId.size === 0) {
      return null
    }

    const nodes = Array.from(nodeByEntityId.values()).map(({ node }) => ({
      entityId: node.entityId,
      entityType: node.entityType,
      identity: node.identity,
      meta: node.meta,
      content: node.content,
      referencedOutputs: Array.from(node.referencedOutputs),
      exportedOutputs: Array.from(node.exportedOutputs),
    }))

    return {
      nodes,
      implicitReferences: Array.from(implicitReferencesByKey.values()),
      explicitReferences: Array.from(explicitReferencesByKey.values()),
    }
  }
}
