import type { UnitInputValue, VersionedName } from "@highstate/contract"
import type { LibraryModel, ResolvedInstanceInput } from "../shared"

export type ResolveUnitInputValuesOptions = {
  library: LibraryModel
  inputName: string
  resolvedInput: ResolvedInstanceInput
  dependencyInstanceType: VersionedName
  captured: Record<string, unknown>[]
}

export function resolveUnitInputValues(options: ResolveUnitInputValuesOptions): UnitInputValue[] {
  const dependencyComponent = options.library.components[options.dependencyInstanceType]
  if (!dependencyComponent) {
    throw new Error(`Component "${options.dependencyInstanceType}" is not defined in the library`)
  }

  const outputSpec = dependencyComponent.outputs[options.resolvedInput.input.output]
  if (!outputSpec) {
    throw new Error(
      `Output "${options.resolvedInput.input.output}" is not defined on component "${options.dependencyInstanceType}"`,
    )
  }

  const outputEntity = options.library.entities[outputSpec.type]
  if (!outputEntity) {
    throw new Error(`Entity type "${outputSpec.type}" is not defined in the library`)
  }

  if (options.captured.length === 0) {
    return []
  }

  // if output type matches input type or extends it, no transformation needed
  if (
    options.resolvedInput.type === outputSpec.type ||
    outputEntity.extensions?.includes(options.resolvedInput.type)
  ) {
    return options.captured.map(value => ({
      value,
      source: {
        instanceId: options.resolvedInput.input.instanceId,
        output: options.resolvedInput.input.output,
      },
    }))
  }

  // otherwise, find matching inclusion to perform transformation
  const inclusion = outputEntity.inclusions?.find(inc => inc.type === options.resolvedInput.type)
  if (!inclusion) {
    throw new Error(
      `Cannot use output "${options.resolvedInput.input.output}" of type "${outputSpec.type}" from instance "${options.resolvedInput.input.instanceId}" for input "${options.inputName}" of type "${options.resolvedInput.type}": no matching inclusion found in entity "${outputEntity.type}"`,
    )
  }

  const extractedValues: unknown[] = []

  for (const value of options.captured) {
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
    },
  }))
}
