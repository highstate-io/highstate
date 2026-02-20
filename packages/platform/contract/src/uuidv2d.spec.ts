import { describe, expect, it } from "vitest"
import { cuidv2d } from "./uuidv2d"

describe("cuidv2d", () => {
  it("is deterministic for the same inputs", () => {
    const id1 = cuidv2d("entityType", "identity")
    const id2 = cuidv2d("entityType", "identity")

    expect(id1).toBe(id2)
  })

  it("changes when identity changes", () => {
    const id1 = cuidv2d("entityType", "identity1")
    const id2 = cuidv2d("entityType", "identity2")

    expect(id1).not.toBe(id2)
  })

  it("changes when namespace changes", () => {
    const id1 = cuidv2d("entityType1", "identity")
    const id2 = cuidv2d("entityType2", "identity")

    expect(id1).not.toBe(id2)
  })

  it("uses the CUIDv2 format with a fixed 'c' prefix", () => {
    const id = cuidv2d("entityType", "identity")

    expect(id).toMatch(/^c[0-9a-z]{23}$/)
    expect(id).toHaveLength(24)
  })

  it("does not collide for ambiguous concatenations", () => {
    const a = cuidv2d("ab", "c")
    const b = cuidv2d("a", "bc")

    expect(a).not.toBe(b)
  })
})
