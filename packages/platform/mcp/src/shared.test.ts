import { describe, expect, it } from "vitest"
import { mergePosition, timestampFromUlid } from "./shared"

describe("mergePosition", () => {
  it("preserves the omitted coordinate from the current position", () => {
    expect(mergePosition({ x: 12 }, { x: 4, y: 8 })).toEqual({ x: 12, y: 8 })
    expect(mergePosition({ y: 18 }, { x: 4, y: 8 })).toEqual({ x: 4, y: 18 })
  })

  it("preserves explicit position clears", () => {
    expect(mergePosition(null, { x: 4, y: 8 })).toBeNull()
    expect(mergePosition(undefined, { x: 4, y: 8 })).toBeUndefined()
  })
})

describe("timestampFromUlid", () => {
  it("returns the ISO timestamp encoded by a ULID", () => {
    expect(timestampFromUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("2016-07-30T23:54:10.259Z")
  })

  it("returns an invalid ID unchanged", () => {
    expect(timestampFromUlid("invalid")).toBe("invalid")
  })
})
