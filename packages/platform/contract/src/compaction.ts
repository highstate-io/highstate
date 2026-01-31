import { mapValues } from "remeda"
import { HighstateSignature, objectRefSchema, objectWithIdSchema } from "./instance"

export function compact<T>(value: T): unknown {
  const counts = new WeakMap<object, number>()
  const cyclic = new WeakSet<object>()
  const expanded = new WeakSet<object>()
  const inStack = new WeakSet<object>()
  const stack: object[] = []

  function countIdentities(current: unknown): void {
    if (current === null || typeof current !== "object") {
      return
    }

    counts.set(current, (counts.get(current) ?? 0) + 1)

    if (inStack.has(current)) {
      cyclic.add(current)

      for (const entry of stack) {
        cyclic.add(entry)
      }
      return
    }

    if (expanded.has(current)) {
      return
    }

    expanded.add(current)
    inStack.add(current)
    stack.push(current)

    if (Array.isArray(current)) {
      try {
        for (const item of current) {
          countIdentities(item)
        }
        return
      } finally {
        stack.pop()
        inStack.delete(current)
      }
    }

    try {
      for (const entryValue of Object.values(current)) {
        countIdentities(entryValue)
      }
    } finally {
      stack.pop()
      inStack.delete(current)
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
    const expandedQueue = new WeakSet<object>()

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

      if (expandedQueue.has(current.value)) {
        continue
      }

      expandedQueue.add(current.value)

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

  function buildTreeChildren(current: object, rootOfIdValue?: object): unknown {
    if (Array.isArray(current)) {
      return current.map(item => buildTree(item, rootOfIdValue))
    }

    return mapValues(current, entryValue => buildTree(entryValue, rootOfIdValue))
  }

  function buildTree(current: unknown, rootOfIdValue?: object): unknown {
    if (current === null || typeof current !== "object") {
      return current
    }

    // Inside an Id value, never emit nested Id wrappers.
    // Match existing real-world snapshot: do not introduce refs for nested objects
    // unless the nested object has already been defined earlier.
    if (rootOfIdValue !== undefined && emitted.has(current)) {
      const id = ids.get(current)
      if (id === undefined) {
        throw new Error("Compaction invariant violation: missing id for repeated object")
      }

      return {
        [HighstateSignature.Ref]: true,
        id,
      }
    }

    // Cycles inside an Id value require defining the cyclic objects inline,
    // otherwise we would infinitely recurse.
    if (rootOfIdValue !== undefined && cyclic.has(current) && !emitted.has(current)) {
      const id = ensureId(current)
      emitted.add(current)

      return {
        [HighstateSignature.Id]: true,
        id,
        value: buildTreeChildren(current, current),
      }
    }

    return buildTreeChildren(current, rootOfIdValue)
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
      value: buildTreeChildren(current, current),
    }
  }

  // Prefer keeping the top-level value unwrapped for stability.
  if (value === null || typeof value !== "object") {
    return value
  }

  const topLevelOccurrences = counts.get(value) ?? 0
  if (topLevelOccurrences > 1) {
    const id = ensureId(value)
    emitted.add(value)

    return {
      [HighstateSignature.Id]: true,
      id,
      value: buildTreeChildren(value, value),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => buildAt(value, index, item))
  }

  return mapValues(value as Record<string, unknown>, (entryValue, entryKey) =>
    buildAt(value as Record<string, unknown>, entryKey, entryValue),
  )
}

export function decompact<T>(value: unknown): T {
  const rawValuesById = new Map<number, unknown>()
  const placeholdersById = new Map<number, unknown>()

  function collect(current: unknown, visited: WeakSet<object>): void {
    const result = objectWithIdSchema.safeParse(current)
    if (result.success) {
      const { id } = result.data
      if (rawValuesById.has(id)) {
        throw new Error(`Duplicate compacted id ${id}`)
      }

      rawValuesById.set(id, result.data.value)
      collect(result.data.value, visited)
      return
    }

    if (current === null || current === undefined || typeof current !== "object") {
      return
    }

    if (visited.has(current)) {
      return
    }

    visited.add(current)

    if (Array.isArray(current)) {
      for (const item of current) {
        collect(item, visited)
      }
      return
    }

    for (const entryValue of Object.values(current)) {
      collect(entryValue, visited)
    }
  }

  function ensurePlaceholder(id: number): unknown {
    const existing = placeholdersById.get(id)
    if (existing !== undefined) {
      return existing
    }

    const raw = rawValuesById.get(id)
    if (raw === undefined) {
      throw new Error(`Unresolved compacted ref id ${id}`)
    }

    let placeholder: unknown
    if (raw !== null && typeof raw === "object") {
      placeholder = Array.isArray(raw) ? [] : {}
    } else {
      placeholder = raw
    }

    placeholdersById.set(id, placeholder)
    return placeholder
  }

  function resolve(current: unknown): unknown {
    const refResult = objectRefSchema.safeParse(current)
    if (refResult.success) {
      return ensurePlaceholder(refResult.data.id)
    }

    const withIdResult = objectWithIdSchema.safeParse(current)
    if (withIdResult.success) {
      return ensurePlaceholder(withIdResult.data.id)
    }

    if (current === null || current === undefined || typeof current !== "object") {
      return current
    }

    if (Array.isArray(current)) {
      return current.map(item => resolve(item))
    }

    return mapValues(current, entryValue => resolve(entryValue))
  }

  function fillPlaceholder(id: number, visitedIds: Set<number>): void {
    if (visitedIds.has(id)) {
      return
    }

    visitedIds.add(id)

    const raw = rawValuesById.get(id)
    if (raw === undefined) {
      throw new Error(`Unresolved compacted ref id ${id}`)
    }

    const placeholder = ensurePlaceholder(id)
    if (placeholder === null || typeof placeholder !== "object") {
      return
    }

    if (raw === null || typeof raw !== "object") {
      throw new Error(`Compaction invariant violation: id ${id} points to non-object value`)
    }

    const resolved = resolve(raw)

    if (Array.isArray(placeholder)) {
      if (!Array.isArray(resolved)) {
        throw new Error(`Compaction invariant violation: id ${id} array placeholder mismatch`)
      }

      placeholder.length = 0
      for (const item of resolved) {
        placeholder.push(item)
      }
      return
    }

    if (Array.isArray(resolved) || resolved === null || typeof resolved !== "object") {
      throw new Error(`Compaction invariant violation: id ${id} object placeholder mismatch`)
    }

    for (const [key, entryValue] of Object.entries(resolved)) {
      ;(placeholder as Record<string, unknown>)[key] = entryValue
    }
  }

  collect(value, new WeakSet<object>())

  for (const id of rawValuesById.keys()) {
    ensurePlaceholder(id)
  }

  const visitedIds = new Set<number>()
  for (const id of rawValuesById.keys()) {
    fillPlaceholder(id, visitedIds)
  }

  return resolve(value) as T
}
