import type { ComponentModel, EntityModel, InstanceInput, InstanceModel } from "@highstate/contract"

export type InstanceTypeContext = {
  instance: InstanceModel
  component: ComponentModel
  entities: Readonly<Record<string, EntityModel>>
}

export type ResolveEffectiveOutputTypeOptions = {
  input: InstanceInput
  fallbackType: string
  getInstanceContext: (instanceId: string) => InstanceTypeContext | undefined
  visited?: Set<string>
}

/**
 * Resolves the effective entity type of a connected output.
 *
 * The function starts from the connected output declaration and then applies
 * two additional transformations used by the platform:
 *
 * 1. `fromInput` forwarding.
 * If the output references `fromInput`, it follows that input edge and reuses
 * the upstream effective type when the forwarding source is deterministic.
 *
 * 2. Input `path` traversal.
 * If the edge provides a `path`, the type is narrowed by following entity
 * inclusions segment-by-segment.
 *
 * The function is intentionally conservative.
 * If a forwarding source is ambiguous (missing, multiple, hub/injection-backed,
 * unknown node/entity, or cyclic), it falls back to the declared type.
 *
 * @param options.input The connected instance output reference being consumed.
 * @param options.fallbackType The type to use when resolution cannot continue safely.
 * @param options.getInstanceContext A lookup that returns instance/component/entities for an instance ID.
 * @param options.visited A recursion guard set used to prevent forwarding cycles.
 * @returns The effective resolved output entity type.
 */
export function resolveEffectiveOutputType(options: ResolveEffectiveOutputTypeOptions): string {
  const visited = options.visited ?? new Set<string>()

  const producer = options.getInstanceContext(options.input.instanceId)
  if (!producer) {
    return resolveTypeByPathOrFallbackInclusion({
      rootType: options.fallbackType,
      path: options.input.path,
      entities: undefined,
      fallbackType: options.fallbackType,
    })
  }

  const outputSpec = producer.component.outputs[options.input.output]
  if (!outputSpec) {
    return resolveTypeByPathOrFallbackInclusion({
      rootType: options.fallbackType,
      path: options.input.path,
      entities: producer.entities,
      fallbackType: options.fallbackType,
    })
  }

  let effectiveType: string = outputSpec.type

  if (outputSpec.fromInput) {
    const visitedKey = `${producer.instance.id}:${options.input.output}`
    if (!visited.has(visitedKey)) {
      visited.add(visitedKey)

      const forwardedInputName = outputSpec.fromInput
      const forwardedFallback = producer.component.inputs[forwardedInputName]?.type ?? effectiveType
      const hasHubInputs = (producer.instance.hubInputs?.[forwardedInputName]?.length ?? 0) > 0
      const hasInjectionInputs = (producer.instance.injectionInputs?.length ?? 0) > 0
      const directInputs = producer.instance.inputs?.[forwardedInputName] ?? []

      if (!hasHubInputs && !hasInjectionInputs && directInputs.length === 1) {
        const forwardedInput = directInputs[0]
        if (forwardedInput) {
          effectiveType = resolveEffectiveOutputType({
            input: forwardedInput,
            fallbackType: forwardedFallback,
            getInstanceContext: options.getInstanceContext,
            visited,
          })
        } else {
          effectiveType = forwardedFallback
        }
      } else {
        effectiveType = forwardedFallback
      }
    }
  }

  return resolveTypeByPathOrFallbackInclusion({
    rootType: effectiveType,
    path: options.input.path,
    entities: producer.entities,
    fallbackType: options.fallbackType,
  })
}

function resolveTypeByPathOrFallbackInclusion(options: {
  rootType: string
  path: string | undefined
  entities: Readonly<Record<string, EntityModel>> | undefined
  fallbackType: string
}): string {
  const { rootType, path, entities, fallbackType } = options

  if (!path || !entities) {
    return resolveTypeByImplicitInclusion(rootType, fallbackType, entities)
  }

  let currentType = rootType
  const segments = path.split(".")

  for (const segment of segments) {
    const entity = entities[currentType]
    if (!entity) {
      return rootType
    }

    const inclusion = entity.inclusions?.find(inc => inc.field === segment)
    if (!inclusion) {
      return rootType
    }

    currentType = inclusion.type
  }

  return currentType
}

function resolveTypeByImplicitInclusion(
  rootType: string,
  fallbackType: string,
  entities: Readonly<Record<string, EntityModel>> | undefined,
): string {
  if (!entities) {
    return rootType
  }

  if (rootType === fallbackType) {
    return rootType
  }

  const rootEntity = entities[rootType]
  if (!rootEntity) {
    return rootType
  }

  if (rootEntity.extensions?.includes(fallbackType)) {
    return rootType
  }

  const inclusion = rootEntity.inclusions?.find(inc => inc.type === fallbackType)
  if (inclusion) {
    return fallbackType
  }

  return rootType
}
