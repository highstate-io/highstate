import { describe, expect, test } from "vitest"
import { collectReleaseGroupPackages, withReleaseGroup } from "./release-groups"

const configuration = {
  release: {
    groups: {
      platform: { projects: ["tag:platform"] },
    },
  },
}

const graph = {
  graph: {
    nodes: {
      create: {
        data: {
          tags: ["npm:public", "platform"],
          metadata: { js: { packageName: "create-highstate" } },
        },
      },
      private: {
        data: {
          tags: ["platform"],
          metadata: { js: { packageName: "@highstate/private" } },
        },
      },
      contract: {
        data: {
          tags: ["npm:public", "platform"],
          metadata: { js: { packageName: "@highstate/contract" } },
        },
      },
      library: {
        data: {
          tags: ["npm:public", "stdlib"],
          metadata: { js: { packageName: "@highstate/library" } },
        },
      },
    },
  },
}

describe("collectReleaseGroupPackages", () => {
  test("collects sorted public packages selected by the Nx group", () => {
    expect(
      collectReleaseGroupPackages(
        configuration,
        graph,
        "platform",
      ),
    ).toEqual(["@highstate/contract", "create-highstate"])
  })

  test("rejects selectors the generator cannot resolve", () => {
    expect(() =>
      collectReleaseGroupPackages(
        { release: { groups: { platform: { projects: ["packages/platform/*"] } } } },
        graph,
        "platform",
      ),
    ).toThrow("Unsupported Nx release group selector")
  })
})

test("withReleaseGroup preserves other Highstate metadata", () => {
  expect(
    withReleaseGroup({ name: "@highstate/contract", highstate: { sourceHash: {} } }, "platform", [
      "@highstate/contract",
    ]),
  ).toEqual({
    name: "@highstate/contract",
    highstate: {
      sourceHash: {},
      release: { group: "platform", packages: ["@highstate/contract"] },
    },
  })
})
