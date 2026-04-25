import { stringify } from "yaml"
import { HighstateSignature } from "@highstate/contract"

export type OutputReferencedEntitySnapshot = {
  snapshotId: string
  entityId: string
  entityType: string
  entityIdentity: string
  content: unknown
}

export type FoldingRegion = {
  start: number
  end: number
}

export type EntitySnapshotLink = {
  line: number
  snapshotId: string
}

type EntityMeta = {
  title?: string
  description?: string
  type?: string
  entityId?: string
  snapshotId?: string
}

type EntityNode = Record<string, unknown> & { $meta: EntityMeta }

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const isEntityNode = (value: unknown): value is EntityNode => {
  if (!isRecord(value)) {
    return false
  }

  if (!("$meta" in value)) {
    return false
  }

  const meta = value.$meta
  if (!isRecord(meta)) {
    return false
  }

  return typeof meta.type === "string" && meta.type.length > 0
}

const isEntityArray = (value: unknown): value is EntityNode[] => {
  return Array.isArray(value) && value.length > 0 && value.every(isEntityNode)
}

const isSecretObject = (
  value: unknown,
): value is { value: unknown } & { [HighstateSignature.Secret]: true } => {
  if (!isRecord(value)) {
    return false
  }

  if (!(HighstateSignature.Secret in value)) {
    return false
  }

  if (value[HighstateSignature.Secret] !== true) {
    return false
  }

  return "value" in value
}

const spaces = (count: number): string => {
  return " ".repeat(Math.max(0, count))
}

const indentYaml = (yaml: string, indent: number): string[] => {
  const trimmed = yaml.trimEnd()
  if (trimmed.length === 0) {
    return []
  }

  return trimmed.split(/\r?\n/).map(line => {
    return line.length > 0 ? `${spaces(indent)}${line}` : line
  })
}

const getEntityHeader = (node: EntityNode): string => {
  const meta = node.$meta
  const title = typeof meta.title === "string" && meta.title.length > 0 ? meta.title : meta.type
  const entityId =
    typeof meta.entityId === "string" && meta.entityId.length > 0
      ? meta.entityId
      : "unknown"

  return `${title} [${entityId}]`
}

const getEntityDescription = (node: EntityNode): string | undefined => {
  const description = node.$meta.description

  if (typeof description !== "string" || description.length === 0) {
    return undefined
  }

  return description
}

const pushYamlObject = (lines: string[], indent: number, object: Record<string, unknown>) => {
  if (Object.keys(object).length === 0) {
    return
  }

  lines.push(...indentYaml(stringify(object), indent))
}

const hasNestedSecrets = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (isSecretObject(value)) {
    return true
  }

  if (Array.isArray(value)) {
    return value.some(item => hasNestedSecrets(item, seen))
  }

  if (!isRecord(value)) {
    return false
  }

  if (seen.has(value)) {
    return false
  }

  seen.add(value)
  return Object.values(value).some(item => hasNestedSecrets(item, seen))
}

const pushSecretBlock = (
  lines: string[],
  regions: FoldingRegion[],
  indent: number,
  value: unknown,
): void => {
  const secretRegionStart = lines.length + 1
  lines.push(`${spaces(indent)}# secret`)
  lines.push(...indentYaml(stringify({ value }), indent))

  const secretRegionEnd = lines.length
  if (secretRegionEnd > secretRegionStart) {
    regions.push({ start: secretRegionStart, end: secretRegionEnd })
  }
}

const pushNestedArrayValue = (
  lines: string[],
  regions: FoldingRegion[],
  indent: number,
  value: unknown[],
): void => {
  if (value.length === 0) {
    lines.push(`${spaces(indent)}[]`)
    return
  }

  for (const item of value) {
    if (isSecretObject(item)) {
      lines.push(`${spaces(indent)}-`)
      pushSecretBlock(lines, regions, indent + 2, item.value)
      continue
    }

    const needsRecursion = hasNestedSecrets(item)
    if (!needsRecursion) {
      lines.push(...indentYaml(stringify([item]), indent))
      continue
    }

    lines.push(`${spaces(indent)}-`)
    pushNestedValue(lines, regions, indent + 2, item)
  }
}

const pushNestedObjectValue = (
  lines: string[],
  regions: FoldingRegion[],
  indent: number,
  value: Record<string, unknown>,
): void => {
  for (const [field, nested] of Object.entries(value)) {
    if (isSecretObject(nested)) {
      lines.push(`${spaces(indent)}${field}:`)
      pushSecretBlock(lines, regions, indent + 2, nested.value)
      continue
    }

    const needsRecursion = hasNestedSecrets(nested)
    if (!needsRecursion) {
      lines.push(...indentYaml(stringify({ [field]: nested }), indent))
      continue
    }

    lines.push(`${spaces(indent)}${field}:`)
    pushNestedValue(lines, regions, indent + 2, nested)
  }
}

const pushNestedValue = (
  lines: string[],
  regions: FoldingRegion[],
  indent: number,
  value: unknown,
): void => {
  if (isSecretObject(value)) {
    pushSecretBlock(lines, regions, indent, value.value)
    return
  }

  if (Array.isArray(value)) {
    pushNestedArrayValue(lines, regions, indent, value)
    return
  }

  if (isRecord(value)) {
    pushNestedObjectValue(lines, regions, indent, value)
    return
  }

  lines.push(...indentYaml(stringify(value), indent))
}

const pushYamlObjectWithNestedSecrets = (
  lines: string[],
  regions: FoldingRegion[],
  indent: number,
  object: Record<string, unknown>,
): void => {
  if (Object.keys(object).length === 0) {
    return
  }

  if (!hasNestedSecrets(object)) {
    pushYamlObject(lines, indent, object)
    return
  }

  pushNestedObjectValue(lines, regions, indent, object)
}

const formatEntityInto = (options: {
  node: EntityNode
  indent: number
  asListItem: boolean
  lines: string[]
  regions: FoldingRegion[]
  links: EntitySnapshotLink[]
  createRegion: boolean
}): void => {
  const startLine = options.lines.length + 1
  const header = getEntityHeader(options.node)
  const description = getEntityDescription(options.node)

  const metaSnapshotId = options.node.$meta.snapshotId
  if (typeof metaSnapshotId === "string" && metaSnapshotId.length > 0) {
    options.links.push({ line: startLine, snapshotId: metaSnapshotId })
  }

  if (options.asListItem) {
    options.lines.push(`${spaces(options.indent)}- # ${header}`)
  } else {
    options.lines.push(`${spaces(options.indent)}# ${header}`)
  }

  const bodyIndent = options.asListItem ? options.indent + 2 : options.indent

  if (description) {
    options.lines.push(`${spaces(bodyIndent)}# ${description}`)
  }

  const plainBuffer: Record<string, unknown> = {}
  const flushPlainBuffer = () => {
    pushYamlObjectWithNestedSecrets(options.lines, options.regions, bodyIndent, plainBuffer)
    for (const key of Object.keys(plainBuffer)) {
      delete plainBuffer[key]
    }
  }

  for (const [field, value] of Object.entries(options.node)) {
    if (field === "$meta") {
      continue
    }

    if (isSecretObject(value)) {
      flushPlainBuffer()

      options.lines.push(`${spaces(bodyIndent)}${field}:`)

      const secretRegionStart = options.lines.length + 1
      options.lines.push(`${spaces(bodyIndent + 2)}# secret`)

      options.lines.push(
        ...indentYaml(
          stringify({ value: (value as { value: unknown }).value }),
          bodyIndent + 2,
        ),
      )

      const secretRegionEnd = options.lines.length
      if (secretRegionEnd > secretRegionStart) {
        options.regions.push({ start: secretRegionStart, end: secretRegionEnd })
      }

      continue
    }

    if (isEntityNode(value) || isEntityArray(value)) {
      flushPlainBuffer()

      options.lines.push(`${spaces(bodyIndent)}${field}:`)

      if (Array.isArray(value)) {
        for (const element of value) {
          formatEntityInto({
            node: element,
            indent: bodyIndent + 2,
            asListItem: true,
            lines: options.lines,
            regions: options.regions,
            links: options.links,
            createRegion: true,
          })
        }
        continue
      }

      formatEntityInto({
        node: value,
        indent: bodyIndent + 2,
        asListItem: false,
        lines: options.lines,
        regions: options.regions,
        links: options.links,
        createRegion: true,
      })

      continue
    }

    plainBuffer[field] = value
  }

  flushPlainBuffer()

  const endLine = options.lines.length
  if (options.createRegion && endLine > startLine) {
    options.regions.push({ start: startLine, end: endLine })
  }
}

export function formatReconstructedEntityValueYaml(value: unknown): {
  yaml: string
  regions: FoldingRegion[]
  links: EntitySnapshotLink[]
} {
  if (!isEntityNode(value)) {
    return { yaml: stringify(value ?? {}), regions: [], links: [] }
  }

  const lines: string[] = []
  const regions: FoldingRegion[] = []
  const links: EntitySnapshotLink[] = []

  formatEntityInto({
    node: value,
    indent: 0,
    asListItem: false,
    lines,
    regions,
    links,
    createRegion: false,
  })

  return { yaml: `${lines.join("\n")}\n`, regions, links }
}

export function stringifyReconstructedEntityValueYaml(value: unknown): string {
  try {
    return formatReconstructedEntityValueYaml(value).yaml
  } catch {
    return "{}\n"
  }
}
