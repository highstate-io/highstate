import type { InstanceInput, MultipleInput, RequiredInput, RuntimeInput } from "./instance"
import { boundaryInput } from "./shared"

type CreateInputOptions = {
  boundary?: InstanceInput
}

function appendInputPath(currentPath: string | undefined, segment: string): string {
  return currentPath ? `${currentPath}.${segment}` : segment
}

function createRuntimeInputAccessor(input: RuntimeInput, boundary: InstanceInput): RuntimeInput {
  const accessorCache = input.provided ? undefined : new Map<string, RuntimeInput>()
  let currentBoundary = boundary

  return new Proxy(input as Record<string | symbol, unknown>, {
    get(target, property, receiver): unknown {
      const runtimeTarget = target as RuntimeInput

      if (property === boundaryInput) {
        return currentBoundary
      }

      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver)
      }

      if (property in target) {
        return Reflect.get(target, property, receiver)
      }

      if (property === "instanceId" || property === "output" || property === "path") {
        return Reflect.get(target, property, receiver)
      }

      if (runtimeTarget.provided) {
        return Reflect.get(runtimeTarget, property, receiver)
      }

      const cached = accessorCache?.get(property)
      if (cached) {
        return cached
      }

      const nested = createNonProvidedInput(boundary, appendInputPath(runtimeTarget.path, property))
      accessorCache?.set(property, nested)

      return nested
    },

    set(target, property, value, receiver): boolean {
      if (property === boundaryInput) {
        currentBoundary = value as InstanceInput
        return true
      }

      return Reflect.set(target, property, value, receiver)
    },
  }) as RuntimeInput
}

/**
 * Creates a runtime input object with boundary and nested accessor behavior.
 *
 * If the source input is non-provided, this function returns a non-provided proxy
 * that can still safely chain nested properties.
 *
 * @param input The source input reference.
 * @param options Optional boundary override.
 */
export function createInput(
  input: RuntimeInput | InstanceInput,
  options: CreateInputOptions = {},
): RuntimeInput {
  if (!("provided" in input)) {
    const boundary = options.boundary ?? input

    const normalizedInput: RequiredInput = {
      provided: true,
      instanceId: input.instanceId,
      output: input.output,
      ...(input.path ? { path: input.path } : {}),
      [boundaryInput]: boundary,
    }

    return createRuntimeInputAccessor(normalizedInput, boundary)
  }

  if (!input.provided) {
    const boundary = options.boundary ?? input[boundaryInput]

    if (!boundary) {
      throw new Error("Cannot create non-provided input without boundary metadata")
    }

    return createNonProvidedInput(boundary, input.path)
  }

  const boundary = options.boundary ?? input[boundaryInput]

  if (!boundary) {
    throw new Error("Cannot create provided input without boundary metadata")
  }

  return createRuntimeInputAccessor(input as RequiredInput, boundary)
}

/**
 * Creates a non-provided runtime input with recursive chained access support.
 *
 * @param boundary The boundary reference propagated across chained properties.
 * @param path Optional path to assign to the non-provided input.
 */
export function createNonProvidedInput(boundary: InstanceInput, path?: string): RuntimeInput {
  const target: RuntimeInput = {
    provided: false,
    ...(path ? { path } : {}),
    [boundaryInput]: boundary,
  }

  return createRuntimeInputAccessor(target, boundary)
}

export function createMultipleInputAccessor(
  inputs: RuntimeInput[],
  boundary: InstanceInput,
): MultipleInput {
  const arrayInputs = [...inputs] as MultipleInput
  arrayInputs[boundaryInput] = boundary

  return new Proxy(arrayInputs as RuntimeInput[], {
    get(target, property, receiver): unknown {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver)
      }

      if (
        property === "length" ||
        property === "map" ||
        property === "filter" ||
        property === "path" ||
        property in target
      ) {
        return Reflect.get(target, property, receiver)
      }

      const unfolded = target.flatMap(input => {
        if (!input.provided) {
          return []
        }

        const selected = (input as Record<string, unknown>)[property]

        if (selected === undefined || selected === null) {
          return []
        }

        if (Array.isArray(selected)) {
          return selected as RuntimeInput[]
        }

        return [selected as RuntimeInput]
      })

      return createMultipleInputAccessor(unfolded, boundary)
    },
  }) as MultipleInput
}

export function createDeepOutputAccessor(output: RuntimeInput): RuntimeInput {
  const normalizedOutput = createInput(output)

  if (!normalizedOutput.provided) {
    return normalizedOutput
  }

  const accessorCache = new Map<string, unknown>()

  return new Proxy(normalizedOutput as Record<string | symbol, unknown>, {
    get(target, property, receiver): unknown {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver)
      }

      if (
        property === "provided" ||
        property === "instanceId" ||
        property === "output" ||
        property === "path"
      ) {
        return Reflect.get(target, property, receiver)
      }

      if (property in target) {
        return Reflect.get(target, property, receiver)
      }

      const cached = accessorCache.get(property)
      if (cached !== undefined) {
        return cached
      }

      const providedTarget = target as RequiredInput

      const nextInput = createInput(
        {
          ...providedTarget,
          path: appendInputPath(providedTarget.path, property),
        },
        { boundary: providedTarget[boundaryInput] },
      )

      const resolved = createDeepOutputAccessor(nextInput)
      accessorCache.set(property, resolved)

      return resolved
    },
  }) as RuntimeInput
}
