import { describe, expect, it } from "vitest"
import { parseVersionedName } from "./meta"

describe("parseVersionedName", () => {
  it("should parse simple versioned names", () => {
    expect(parseVersionedName("component.v1")).toEqual(["component", 1])
    expect(parseVersionedName("service.v10")).toEqual(["service", 10])
  })

  it("should parse multi-part versioned names", () => {
    expect(parseVersionedName("proxmox.virtual-machine.v1")).toEqual(["proxmox.virtual-machine", 1])
    expect(parseVersionedName("k8s.apps.traefik-gateway.v1")).toEqual([
      "k8s.apps.traefik-gateway",
      1,
    ])
  })

  it("should handle multiple '.v' patterns by taking the last one", () => {
    expect(parseVersionedName("test.v1.service.v2")).toEqual(["test.v1.service", 2])
  })

  it("should throw error for invalid names", () => {
    expect(() => parseVersionedName("component")).toThrow("Invalid versioned name: component")
    expect(() => parseVersionedName("")).toThrow("Invalid versioned name: ")
  })

  it("should throw error for invalid versions", () => {
    expect(() => parseVersionedName("component.v-1")).toThrow(
      "Invalid version in versioned name: component.v-1",
    )
    expect(() => parseVersionedName("component.vabc")).toThrow(
      "Invalid version in versioned name: component.vabc",
    )
  })
})
