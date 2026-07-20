import type { k8s } from "@highstate/library"
import { toPromise } from "@highstate/pulumi"
import { describe, expect, it } from "vitest"
import { createServiceSpec } from "./service"

const cluster = {
  externalIps: [{ value: "192.0.2.1" }, { value: "192.0.2.2" }],
} as k8s.Cluster

describe("createServiceSpec", () => {
  it("does not expose an internal service on cluster external IPs", async () => {
    const spec = await toPromise(createServiceSpec({ external: false }, cluster))

    expect(spec.externalIPs).toBeUndefined()
    expect(spec.type).toBe("ClusterIP")
  })

  it("exposes an external service on cluster external IPs", async () => {
    const spec = await toPromise(createServiceSpec({ external: true }, cluster))

    expect(spec.externalIPs).toEqual(["192.0.2.1", "192.0.2.2"])
  })

  it("preserves explicitly configured external IPs", async () => {
    const spec = await toPromise(
      createServiceSpec({ external: false, externalIPs: ["198.51.100.1"] }, cluster),
    )

    expect(spec.externalIPs).toEqual(["198.51.100.1"])
  })
})
