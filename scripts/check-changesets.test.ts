import { expect, test } from "vitest"
import { validateChangesets } from "./check-changesets"

test("accepts patch and minor changesets", () => {
  expect(() =>
    validateChangesets([
      {
        id: "safe-release",
        releases: [
          { name: "@highstate/library", type: "minor" },
          { name: "@highstate/wireguard", type: "patch" },
        ],
      },
    ]),
  ).not.toThrow()
})

test("rejects major changesets with their source and package", () => {
  expect(() =>
    validateChangesets([
      {
        id: "breaking-release",
        releases: [{ name: "@highstate/wireguard", type: "major" }],
      },
    ]),
  ).toThrow(
    "Major changesets are not allowed: .changeset/breaking-release.md (@highstate/wireguard)",
  )
})
