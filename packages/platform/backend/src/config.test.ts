import { describe, expect, it } from "vitest"
import { loadConfig } from "./config"

describe("initial project library configuration", () => {
  it("uses the standard library when no override is supplied", async () => {
    const config = await loadConfig({}, false)

    expect(config.HIGHSTATE_INITIAL_LIBRARY_PACKAGES).toEqual([
      { packageName: "@highstate/library", version: "0.30.2" },
    ])
  })

  it("accepts deterministic exact fixture selections and an empty initial library", async () => {
    for (const selection of [[{ packageName: "@fixture/library", version: "1.0.0" }], []]) {
      const config = await loadConfig(
        {
          HIGHSTATE_INITIAL_LIBRARY_PACKAGES: JSON.stringify(selection),
        },
        false,
      )

      expect(config.HIGHSTATE_INITIAL_LIBRARY_PACKAGES).toEqual(selection)
    }
  })

  it.each([
    "invalid-json",
    "null",
    "{}",
    '[{"packageName":"@fixture/library","version":"latest"}]',
    '[{"packageName":"@fixture/library","version":"^1.0.0"}]',
    '[{"packageName":"@fixture/library","version":"1.0.0"},{"packageName":"@fixture/library","version":"2.0.0"}]',
  ])("rejects malformed or nondeterministic selection: %s", async value => {
    await expect(loadConfig({ HIGHSTATE_INITIAL_LIBRARY_PACKAGES: value }, false)).rejects.toThrow(
      "Failed to parse backend configuration",
    )
  })
})
