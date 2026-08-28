import { describe, expect, it } from "vitest"
import { hubIdSchema, mergePosition, timestampFromUlid, toInstanceUpdateMaskPaths } from "./shared"

describe("hubIdSchema", () => {
  it("matches the backend API hub ID constraint", () => {
    expect(hubIdSchema.safeParse("q8xbilhwpsn65zjlv5kz44qh").success).toBe(true)
    expect(hubIdSchema.safeParse("smoke-hub").success).toBe(false)
  })
})

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

describe("toInstanceUpdateMaskPaths", () => {
  it("maps tool argument fields to protobuf field-mask paths", () => {
    expect(
      toInstanceUpdateMaskPaths({
        args: {},
        inputs: {},
        hub_inputs: {},
        injection_inputs: [],
        position: null,
      }),
    ).toEqual(["arguments", "inputs", "hub_inputs", "injection_inputs", "position"])
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
