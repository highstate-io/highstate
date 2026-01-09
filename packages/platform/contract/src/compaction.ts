import { mapValues } from "remeda"
import { HighstateSignature, objectRefSchema, objectWithIdSchema } from "./instance"

export function compact<T>(value: T): unknown {
  const counts = new WeakMap<object, number>()

  function countIdentities(current: unknown): void {
    if (current === null || typeof current !== "object") {
      return
    }

    counts.set(current, (counts.get(current) ?? 0) + 1)

    if (Array.isArray(current)) {
      for (const item of current) {
        countIdentities(item)
      }
      return
    }

    for (const entryValue of Object.values(current)) {
      countIdentities(entryValue)
    }
  }

  countIdentities(value)

  type DefinitionSite = { parent: object; key: string | number }

  const ids = new WeakMap<object, number>()
  const definitionSites = new WeakMap<object, DefinitionSite>()
  let nextId = 1

  function ensureId(current: object): number {
    const existing = ids.get(current)
    if (existing !== undefined) {
      return existing
    }

    const allocated = nextId
    nextId += 1
    ids.set(current, allocated)
    return allocated
  }

  function assignDefinitionSitesBfs(root: unknown): void {
    if (root === null || typeof root !== "object") {
      return
    }

    const queue: Array<{ parent: object; key: string | number; value: unknown }> = []

    if (Array.isArray(root)) {
      for (let index = 0; index < root.length; index += 1) {
        queue.push({ parent: root, key: index, value: root[index] })
      }
    } else {
      for (const [key, entryValue] of Object.entries(root)) {
        queue.push({ parent: root, key, value: entryValue })
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) {
        continue
      }

      if (current.value === null || typeof current.value !== "object") {
        continue
      }

      const occurrences = counts.get(current.value) ?? 0
      if (occurrences > 1 && definitionSites.get(current.value) === undefined) {
        definitionSites.set(current.value, { parent: current.parent, key: current.key })
        ensureId(current.value)
      }

      if (Array.isArray(current.value)) {
        for (let index = 0; index < current.value.length; index += 1) {
          queue.push({ parent: current.value, key: index, value: current.value[index] })
        }
        continue
      }

      for (const [key, entryValue] of Object.entries(current.value)) {
        queue.push({ parent: current.value, key, value: entryValue })
      }
    }
  }

  assignDefinitionSitesBfs(value)

  const emitted = new WeakSet<object>()

  function buildTree(current: unknown, rootOfIdValue?: object): unknown {
    if (current === null || typeof current !== "object") {
      return current
    }

    // Inside an Id value, never emit nested Id wrappers.
    // Match existing real-world snapshot: do not introduce refs for nested objects
    // unless the nested object has already been defined earlier.
    if (rootOfIdValue !== undefined && current !== rootOfIdValue && emitted.has(current)) {
      const id = ids.get(current)
      if (id === undefined) {
        throw new Error("Compaction invariant violation: missing id for repeated object")
      }

      return {
        [HighstateSignature.Ref]: true,
        id,
      }
    }

    if (Array.isArray(current)) {
      return current.map(item => buildTree(item, rootOfIdValue))
    }

    return mapValues(current, entryValue => buildTree(entryValue, rootOfIdValue))
  }

  function buildAt(parent: object, key: string | number, current: unknown): unknown {
    if (current === null || typeof current !== "object") {
      return current
    }

    const occurrences = counts.get(current) ?? 0
    if (occurrences <= 1) {
      if (Array.isArray(current)) {
        return current.map((item, index) => buildAt(current, index, item))
      }

      return mapValues(current, (entryValue, entryKey) => buildAt(current, entryKey, entryValue))
    }

    const site = definitionSites.get(current)
    const shouldDefineHere = site?.parent === parent && site.key === key

    const id = ids.get(current)
    if (id === undefined) {
      throw new Error("Compaction invariant violation: missing id for repeated object")
    }

    if (!shouldDefineHere || emitted.has(current)) {
      return {
        [HighstateSignature.Ref]: true,
        id,
      }
    }

    emitted.add(current)

    return {
      [HighstateSignature.Id]: true,
      id,
      value: buildTree(current, current),
    }
  }

  // Prefer keeping the top-level value unwrapped for stability.
  if (value === null || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => buildAt(value, index, item))
  }

  return mapValues(value as Record<string, unknown>, (entryValue, entryKey) =>
    buildAt(value as Record<string, unknown>, entryKey, entryValue),
  )
}

export function decompact<T>(value: unknown): T {
  const valuesById = new Map<number, unknown>()

  function collect(current: unknown): void {
    const result = objectWithIdSchema.safeParse(current)
    if (result.success) {
      const { id } = result.data
      if (valuesById.has(id)) {
        throw new Error(`Duplicate compacted id ${id}`)
      }

      valuesById.set(id, result.data.value)
      collect(result.data.value)
      return
    }

    if (current === null || current === undefined || typeof current !== "object") {
      return
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        collect(item)
      }
      return
    }

    for (const entryValue of Object.values(current)) {
      collect(entryValue)
    }
  }

  function traverse(current: unknown): unknown {
    const refResult = objectRefSchema.safeParse(current)
    if (refResult.success) {
      const target = valuesById.get(refResult.data.id)
      if (target === undefined) {
        throw new Error(`Unresolved compacted ref id ${refResult.data.id}`)
      }

      return traverse(target)
    }

    const withIdResult = objectWithIdSchema.safeParse(current)
    if (withIdResult.success) {
      return traverse(withIdResult.data.value)
    }

    if (current === null || current === undefined || typeof current !== "object") {
      return current
    }

    if (Array.isArray(current)) {
      return current.map(item => traverse(item))
    }

    return mapValues(current, entryValue => traverse(entryValue))
  }

  collect(value)
  return traverse(value) as T
}
