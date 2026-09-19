import { describe, expect, it } from "vitest"
import { parsePageSize } from "./project"

describe("project list pagination", () => {
  it("omits page size when no option is provided", () => {
    expect(parsePageSize(undefined)).toBeUndefined()
  })

  it("parses an explicit page size", () => {
    expect(parsePageSize("20")).toBe(20)
  })

  it.each(["0", "101", "1.5", "invalid"])("rejects invalid page size %s", value => {
    expect(() => parsePageSize(value)).toThrow("Page size must be an integer between 1 and 100")
  })
})
