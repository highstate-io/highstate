import { describe, expect, it } from "vitest"
import { toJsonObject } from "./serialization"

describe("toJsonObject", () => {
  it("normalizes dates and removes undefined values", () => {
    expect(
      toJsonObject({
        createdAt: new Date("2026-08-22T12:00:00.000Z"),
        omitted: undefined,
        nested: [{ value: 1 }],
      }),
    ).toEqual({
      createdAt: "2026-08-22T12:00:00.000Z",
      nested: [{ value: 1 }],
    })
  })
})
