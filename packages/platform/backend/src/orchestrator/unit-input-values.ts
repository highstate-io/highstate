import type { UnitInputValue, VersionedName } from "@highstate/contract"
import type { CapturedEntitySnapshotValue } from "../business"
import type { LibraryModel, ResolvedInstanceInput } from "../shared"

type InclusionStep = {
  field: string
  multiple: boolean
  type: string
}

type ParsedPathSegment = {
  field: string
}

type EntityModelLike = {
  type: string
  extensions?: string[]
  inclusions?: {
    field: string
    type: string
    multiple: boolean
  }[]
}

function parseInclusionPath(path: string): ParsedPathSegment[] {
  if (path.length === 0) {
    throw new Error("Input path cannot be empty")
  }

  const segments = path.split(".")

  return segments.map(segment => {
    const match = /^([^.[\]]+)$/.exec(segment)
    if (!match) {
      throw new Error(`Invalid input path segment "${segment}". Expected format "field".`)
    }

    return {
      field: match[1],
    }
  })
}

function resolveInclusionPath(options: {
  library: LibraryModel
  rootEntity: EntityModelLike
  path: string
}): InclusionStep[] {
  const segments = parseInclusionPath(options.path)
  const steps: InclusionStep[] = []
  let current = options.rootEntity

  for (const segment of segments) {
    const inclusion = current.inclusions?.find(inc => inc.field === segment.field)
    if (!inclusion) {
      throw new Error(
        `Invalid input path "${options.path}": inclusion "${segment.field}" is not defined on entity "${current.type}".`,
      )
    }

    steps.push(inclusion)

    const nextEntity = options.library.entities[inclusion.type]
    if (!nextEntity) {
      throw new Error(
        `Invalid input path "${options.path}": entity type "${inclusion.type}" is not defined in the library.`,
      )
    }

    current = nextEntity
  }

  return steps
}

function extractByInclusionPath(options: {
  values: unknown[]
  steps: InclusionStep[]
  outputName: string
  instanceId: string
  path: string
}): unknown[] {
  let currentValues = options.values

  for (const step of options.steps) {
    const nextValues: unknown[] = []

    for (const value of currentValues) {
      if (typeof value !== "object" || value === null) {
        throw new Error(
          `Cannot extract inclusion path "${options.path}" from non-object output "${options.outputName}" of instance "${options.instanceId}".`,
        )
      }

      const extracted = (value as Record<string, unknown>)[step.field]

      if (extracted === undefined || extracted === null) {
        continue
      }

      if (step.multiple) {
        if (!Array.isArray(extracted)) {
          throw new Error(
            `Expected inclusion field "${step.field}" on output "${options.outputName}" to be an array while resolving path "${options.path}".`,
          )
        }

        for (const item of extracted) {
          nextValues.push(item)
        }

        continue
      }

      nextValues.push(extracted)
    }

    currentValues = nextValues
  }

  return currentValues
}

function isEntityAssignableTo(entity: EntityModelLike, requiredType: string): boolean {
  return entity.type === requiredType || !!entity.extensions?.includes(requiredType)
}

export type ResolveUnitInputValuesOptions = {
  library: LibraryModel
  inputName: string
  resolvedInput: ResolvedInstanceInput
  dependencyInstanceType: VersionedName
  captured: CapturedEntitySnapshotValue[]
  effectiveOutputType?: string
  effectiveRootOutputType?: string
}

export function resolveUnitInputValues(options: ResolveUnitInputValuesOptions): UnitInputValue[] {
  const dependencyComponent = options.library.components[options.dependencyInstanceType]!

  const outputSpec = dependencyComponent.outputs[options.resolvedInput.input.output]
  if (!outputSpec) {
    throw new Error(
      `Output "${options.resolvedInput.input.output}" is not defined on component "${options.dependencyInstanceType}"`,
    )
  }

  const effectiveOutputType = options.effectiveOutputType ?? outputSpec.type
  const effectiveRootOutputType = options.effectiveRootOutputType ?? effectiveOutputType

  const outputEntity = options.library.entities[effectiveRootOutputType]
  if (!outputEntity) {
    throw new Error(`Entity type "${effectiveRootOutputType}" is not defined in the library`)
  }

  const effectiveOutputEntity = options.library.entities[effectiveOutputType]
  if (!effectiveOutputEntity) {
    throw new Error(`Entity type "${effectiveOutputType}" is not defined in the library`)
  }

  if (options.captured.length === 0) {
    return []
  }

  const capturedValues = options.captured.map(item => {
    if (item.ok) {
      return item.value
    }

    throw new Error(
      `Cannot use captured output "${options.resolvedInput.input.output}" from instance "${options.resolvedInput.input.instanceId}" for input "${options.inputName}": failed to reconstruct entity snapshot "${item.error.snapshotId}": ${item.error.message}`,
    )
  })

  const explicitPath = options.resolvedInput.input.path
  if (explicitPath) {
    const inclusionSteps = resolveInclusionPath({
      library: options.library,
      rootEntity: outputEntity,
      path: explicitPath,
    })

    const targetType = inclusionSteps.at(-1)?.type
    if (!targetType) {
      throw new Error(
        `Invalid input path "${explicitPath}" for output "${options.resolvedInput.input.output}": no inclusion steps resolved.`,
      )
    }

    const targetEntity = options.library.entities[targetType]
    if (!targetEntity) {
      throw new Error(`Entity type "${targetType}" is not defined in the library`)
    }

    if (!isEntityAssignableTo(targetEntity, options.resolvedInput.type)) {
      throw new Error(
        `Cannot use output "${options.resolvedInput.input.output}" path "${explicitPath}" of type "${effectiveRootOutputType}" from instance "${options.resolvedInput.input.instanceId}" for input "${options.inputName}" of type "${options.resolvedInput.type}": resolved path type is "${targetEntity.type}".`,
      )
    }

    const extractedValues = extractByInclusionPath({
      values: capturedValues,
      steps: inclusionSteps,
      outputName: options.resolvedInput.input.output,
      instanceId: options.resolvedInput.input.instanceId,
      path: explicitPath,
    })

    return extractedValues.map(extracted => ({
      value: extracted,
      source: {
        instanceId: options.resolvedInput.input.instanceId,
        output: options.resolvedInput.input.output,
        path: explicitPath,
      },
    }))
  }

  // if output type matches input type or extends it, no transformation needed
  if (
    options.resolvedInput.type === effectiveOutputType ||
    effectiveOutputEntity.extensions?.includes(options.resolvedInput.type)
  ) {
    return capturedValues.map(value => ({
      value: value,
      source: {
        instanceId: options.resolvedInput.input.instanceId,
        output: options.resolvedInput.input.output,
        path: options.resolvedInput.input.path,
      },
    }))
  }

  // otherwise, find matching inclusion to perform transformation
  const inclusion = outputEntity.inclusions?.find(inc => inc.type === options.resolvedInput.type)
  if (!inclusion) {
    throw new Error(
      `Cannot use output "${options.resolvedInput.input.output}" of type "${effectiveOutputType}" from instance "${options.resolvedInput.input.instanceId}" for input "${options.inputName}" of type "${options.resolvedInput.type}": no matching inclusion found in entity "${outputEntity.type}"`,
    )
  }

  const extractedValues: unknown[] = []

  for (const value of capturedValues) {
    if (typeof value !== "object" || value === null) {
      throw new Error(
        `Cannot extract field "${inclusion.field}" from non-object output "${options.resolvedInput.input.output}" of instance "${options.resolvedInput.input.instanceId}".`,
      )
    }

    const extracted = (value as Record<string, unknown>)[inclusion.field]

    if (extracted === undefined || extracted === null) {
      continue
    }

    if (inclusion.multiple) {
      if (!Array.isArray(extracted)) {
        throw new Error(
          `Expected inclusion field "${inclusion.field}" on output "${options.resolvedInput.input.output}" to be an array.`,
        )
      }

      for (const item of extracted) {
        extractedValues.push(item)
      }
      continue
    }

    extractedValues.push(extracted)
  }

  return extractedValues.map(extracted => ({
    value: extracted,
    source: {
      instanceId: options.resolvedInput.input.instanceId,
      output: options.resolvedInput.input.output,
      path: options.resolvedInput.input.path,
    },
  }))
}
