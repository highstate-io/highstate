import { expect, test } from "vitest"
import { parseChangeset, validateChangesets } from "./check-changesets"

test("parses changeset frontmatter without Git branch state", () => {
  expect(
    parseChangeset(
      "safe-release",
      `---
"@highstate/library": minor
'@highstate/wireguard': patch
---

Release summary.
`,
    ),
  ).toEqual({
    id: "safe-release",
    releases: [
      { name: "@highstate/library", type: "minor" },
      { name: "@highstate/wireguard", type: "patch" },
    ],
  })
})

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
