import type {
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
import { encode } from "@msgpack/msgpack"
import { sha256 } from "@noble/hashes/sha2"
import { createId } from "@paralleldrive/cuid2"
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
  implicitReferences: { fromNodeId: string; toNodeId: string }[]
}

export type UnitEntitySnapshotNode = {
  nodeId: string
  entityType: VersionedName
  output: string
  identity?: string
  meta: {
    title: string
    description?: string
    icon?: string
    iconColor?: string
  }
  content: Record<string, unknown>
  explicitReferences: string[]
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

    const entitySnapshotPayload = await this.parseEntitySnapshotPayload({
      libraryId: options.libraryId,
      instanceType: options.instanceType,
      unitOutputs,
      signal: options.signal,
    })

    return {
      outputHash,
      statusFields,
      terminals,
      pages,
      triggers,
      secrets,
      workers,
      exportedArtifactIds,
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

    const nodes: UnitEntitySnapshotPayload["nodes"] = []
    const implicitReferences: UnitEntitySnapshotPayload["implicitReferences"] = []
    const nodeIdByObjectAndOutput = new WeakMap<object, Map<string, string>>()
    const nodeIdByDeterministicKey = new Map<string, string>()

    const getOrCreateNodeId = (
      entityType: UnitEntitySnapshotPayload["nodes"][number]["entityType"],
      output: string,
      identity: string | undefined,
      value: object,
    ): string => {
      if (identity) {
        const key = `${entityType}:${identity}:${output}`
        const existing = nodeIdByDeterministicKey.get(key)
        if (existing) {
          return existing
        }

        const created = createId()
        nodeIdByDeterministicKey.set(key, created)
        return created
      }

      const outputMap = nodeIdByObjectAndOutput.get(value) ?? new Map<string, string>()
      const existing = outputMap.get(output)
      if (existing) {
        return existing
      }

      const created = createId()
      outputMap.set(output, created)
      nodeIdByObjectAndOutput.set(value, outputMap)
      return created
    }

    const collectEntityValue = async (
      entityType: UnitEntitySnapshotPayload["nodes"][number]["entityType"],
      output: string,
      value: unknown,
    ): Promise<string> => {
      if (typeof value !== "object" || value === null) {
        throw new Error(`Expected entity value for type "${entityType}" to be an object`)
      }

      const record = value as Record<string, unknown>
      const rawMeta = record.$meta
      const meta =
        typeof rawMeta === "object" && rawMeta !== null
          ? (rawMeta as Record<string, unknown>)
          : undefined

      const identity = typeof meta?.identity === "string" ? meta.identity : undefined
      const nodeId = getOrCreateNodeId(entityType, output, identity, value)

      if (!nodes.some(n => n.nodeId === nodeId)) {
        const { $meta: _ignoredMeta, ...content } = record

        nodes.push({
          nodeId,
          entityType,
          output,
          identity,
          meta: {
            title: typeof meta?.title === "string" ? meta.title : entityType,
            ...(typeof meta?.description === "string" ? { description: meta.description } : {}),
            ...(typeof meta?.icon === "string" ? { icon: meta.icon } : {}),
            ...(typeof meta?.iconColor === "string" ? { iconColor: meta.iconColor } : {}),
          },
          content,
          explicitReferences: Array.isArray(meta?.references)
            ? meta.references.filter((x): x is string => typeof x === "string")
            : [],
        })

        const entityModel = library.entities[entityType]
        if (!entityModel) {
          throw new Error(`Entity type "${entityType}" is not defined in the library`)
        }

        for (const inclusion of entityModel.inclusions ?? []) {
          const rawIncluded = record[inclusion.field]
          if (rawIncluded === undefined || rawIncluded === null) {
            continue
          }

          if (inclusion.multiple) {
            if (!Array.isArray(rawIncluded)) {
              throw new Error(
                `Expected inclusion field "${inclusion.field}" on "${entityType}" to be an array`,
              )
            }

            for (const item of rawIncluded) {
              const childNodeId = await collectEntityValue(inclusion.type, output, item)
              implicitReferences.push({ fromNodeId: nodeId, toNodeId: childNodeId })
            }
          } else {
            const childNodeId = await collectEntityValue(inclusion.type, output, rawIncluded)
            implicitReferences.push({ fromNodeId: nodeId, toNodeId: childNodeId })
          }
        }
      }

      return nodeId
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
          await collectEntityValue(outputSpec.type, outputName, item)
        }
      } else {
        await collectEntityValue(outputSpec.type, outputName, outputValue)
      }
    }

    if (nodes.length === 0) {
      return null
    }

    return { nodes, implicitReferences }
  }
}
