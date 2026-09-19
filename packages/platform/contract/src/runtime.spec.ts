import { describe, expect, it } from "vitest"
import { runtimeSidecarStartInputSchema } from "./runtime"

const input = {
  image: "example.invalid/sidecar@sha256:abc",
}

describe("runtimeSidecarStartInputSchema", () => {
  it("accepts a complete caller-provided DNS name", () => {
    expect(
      runtimeSidecarStartInputSchema.parse({
        ...input,
        dnsName: "endpoint-123.highstate.local",
      }).dnsName,
    ).toBe("endpoint-123.highstate.local")
  })

  it.each([
    "Endpoint.highstate.local",
    "endpoint..local",
    "-endpoint.local",
  ])("rejects invalid DNS name %s", dnsName => {
    expect(() => runtimeSidecarStartInputSchema.parse({ ...input, dnsName })).toThrow()
  })
})
