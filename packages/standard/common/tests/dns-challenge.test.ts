import { describe, expect, it, vi } from "vitest"
import { isDnsNameInZone, validateDnsChallengeAliases } from "../src/shared/dns-challenge"

describe("DNS challenge delegation", () => {
  it("checks the original challenge record and selects the delegated issuer zone", async () => {
    const lookup = vi.fn().mockResolvedValue(["_acme-challenge.Router.Managed.Example."])
    await expect(
      validateDnsChallengeAliases(
        ["API.External.Example", "direct.managed.example"],
        { "api.external.example": "_acme-challenge.router.managed.example" },
        lookup,
      ),
    ).resolves.toEqual(["_acme-challenge.router.managed.example", "direct.managed.example"])
    expect(lookup).toHaveBeenCalledWith("_acme-challenge.api.external.example")
  })

  it("uses the base name for wildcard challenges and deduplicates shared records", async () => {
    const lookup = vi.fn().mockResolvedValue(["validation.managed.example."])
    await validateDnsChallengeAliases(
      ["*.external.example", "external.example"],
      {
        "*.external.example": "validation.managed.example",
        "external.example": "validation.managed.example",
      },
      lookup,
    )
    expect(lookup).toHaveBeenCalledExactlyOnceWith("_acme-challenge.external.example")
  })

  it("rejects an incorrect CNAME target", async () => {
    await expect(
      validateDnsChallengeAliases(
        ["api.external.example"],
        { "api.external.example": "validation.managed.example" },
        async () => ["wrong.managed.example"],
      ),
    ).rejects.toThrow('Expected CNAME "_acme-challenge.api.external.example"')
  })

  it("reports a missing CNAME with the original DNS failure", async () => {
    const error = new Error("ENODATA")
    await expect(
      validateDnsChallengeAliases(
        ["api.external.example"],
        { "api.external.example": "validation.managed.example" },
        async () => { throw error },
      ),
    ).rejects.toMatchObject({ cause: error })
  })

  it("rejects aliases for names outside the certificate", async () => {
    await expect(
      validateDnsChallengeAliases([], { "unrequested.example": "validation.managed.example" }),
    ).rejects.toThrow("unrequested certificate name")
  })

  it("rejects conflicting wildcard and base-name delegations", async () => {
    await expect(
      validateDnsChallengeAliases(
        ["*.external.example", "external.example"],
        { "*.external.example": "one.managed.example", "external.example": "two.managed.example" },
        async () => ["one.managed.example"],
      ),
    ).rejects.toThrow("Conflicting DNS challenge aliases")
  })

  it("requires a DNS label boundary when matching an issuer zone", () => {
    expect(isDnsNameInZone("validation.MANAGED.example.", "managed.example")).toBe(true)
    expect(isDnsNameInZone("managed.example", "managed.example.")).toBe(true)
    expect(isDnsNameInZone("unmanaged.example", "managed.example")).toBe(false)
  })
})
