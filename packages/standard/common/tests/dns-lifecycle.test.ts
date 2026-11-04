import { describe, expect, it } from "vitest"
import { getDnsRecordFamily } from "../src/shared/dns-lifecycle"

describe("DNS record-set transitions", () => {
  it("distinguishes aliases from compatible address records", () => {
    expect(getDnsRecordFamily(["CNAME"])).toBe("alias")
    expect(getDnsRecordFamily(["A"])).toBe("records")
    expect(getDnsRecordFamily(["AAAA"])).toBe("records")
  })

  it("allows A and AAAA records together", () => {
    expect(getDnsRecordFamily(["A", "AAAA", "A"])).toBe("records")
  })

  it.each([
    ["CNAME", "A"],
    ["AAAA", "CNAME"],
    ["CNAME", "CNAME"],
  ])("rejects incompatible records %s and %s", (...types) => {
    expect(() => getDnsRecordFamily(types)).toThrow("CNAME record cannot coexist")
  })
})
