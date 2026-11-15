import type { EntityModel, VersionedName } from "@highstate/contract"

export type OutputExpressionOption = {
  path: string | undefined
  label: string
  title: string
  type: VersionedName
  depth: number
  required: boolean
  multiple: boolean
  hasChildren: boolean
  assignable: boolean
}

export type CreateOutputExpressionOptionsParams = {
  rootType: VersionedName
  targetType: VersionedName
  entities: Readonly<Record<string, EntityModel | undefined>>
  maxDepth?: number
}

const defaultMaxDepth = 5

function isInheritedAssignableTo(entity: EntityModel, targetType: VersionedName): boolean {
  return entity.type === targetType || (entity.extensions?.includes(targetType) ?? false)
}

export function createOutputExpressionOptions({
  rootType,
  targetType,
  entities,
  maxDepth = defaultMaxDepth,
}: CreateOutputExpressionOptionsParams): OutputExpressionOption[] {
  const options: OutputExpressionOption[] = []
  const visited = new Set<string>()

  const visit = (
    type: VersionedName,
    path: string | undefined,
    depth: number,
    required: boolean,
    multiple: boolean,
  ) => {
    const entity = entities[type]
    const inclusions = entity?.inclusions ?? []
    const visitedKey = `${type}:${path ?? ""}`

    if (visited.has(visitedKey)) {
      return
    }

    visited.add(visitedKey)

    options.push({
      path,
      label: path ?? "output",
      title: entity?.meta.title ?? type,
      type,
      depth,
      required,
      multiple,
      hasChildren: inclusions.length > 0 && depth < maxDepth,
      assignable: entity ? isInheritedAssignableTo(entity, targetType) : type === targetType,
    })

    if (depth >= maxDepth) {
      return
    }

    for (const inclusion of inclusions) {
      const childPath = path ? `${path}.${inclusion.field}` : inclusion.field
      visit(inclusion.type, childPath, depth + 1, inclusion.required, inclusion.multiple)
    }
  }

  visit(rootType, undefined, 0, true, false)

  return options
}
