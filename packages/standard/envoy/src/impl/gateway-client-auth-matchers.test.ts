import { describe, expect, test } from "bun:test"
import { toDnsNameMatcher } from "./gateway-client-auth-matchers"

describe("toDnsNameMatcher", () => {
  test("uses an exact matcher for names without wildcards", () => {
    expect(toDnsNameMatcher("example.com")).toEqual({
      type: "Exact",
      value: "example.com",
    })
  })

  test("uses a suffix matcher for leading double-star subdomains", () => {
    expect(toDnsNameMatcher("**.example.com")).toEqual({
      type: "Suffix",
      value: ".example.com",
    })
  })

  test("uses a regular expression matcher for single-label wildcard subdomains", () => {
    expect(toDnsNameMatcher("*.example.com")).toEqual({
      type: "RegularExpression",
      value: "^[^.]+\\.example\\.com$",
    })
  })

  test("uses a regular expression matcher for wildcard labels in the middle", () => {
    expect(toDnsNameMatcher("*.test.*.example.com")).toEqual({
      type: "RegularExpression",
      value: "^[^.]+\\.test\\.[^.]+\\.example\\.com$",
    })
  })

  test("escapes regular expression syntax in literal labels", () => {
    expect(toDnsNameMatcher("*.test+.example.com")).toEqual({
      type: "RegularExpression",
      value: "^[^.]+\\.test\\+\\.example\\.com$",
    })
  })
})
