import { describe, expect, it } from "vitest"
import { getPulumiEnvironment } from "./environment"

describe("Pulumi runtime environment", () => {
  it("preserves isolated home and plugin paths without forwarding unrelated credentials", () => {
    expect(
      getPulumiEnvironment({
        HOME: "/isolated/home",
        PULUMI_HOME: "/isolated/plugins",
        AWS_SECRET_ACCESS_KEY: "unrelated",
      }),
    ).toEqual({
      HOME: "/isolated/home",
      PULUMI_HOME: "/isolated/plugins",
    })
  })

  it("derives plugin storage from the configured home when not explicitly overridden", () => {
    expect(getPulumiEnvironment({ HOME: "/isolated/home" })).toEqual({
      HOME: "/isolated/home",
      PULUMI_HOME: "/isolated/home/.pulumi",
    })
    expect(getPulumiEnvironment({ USERPROFILE: "/isolated/profile" })).toEqual({
      HOME: "/isolated/profile",
      PULUMI_HOME: "/isolated/profile/.pulumi",
    })
  })
})
