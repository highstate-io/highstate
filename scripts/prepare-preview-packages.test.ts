import { expect, test } from "vitest"
import { replaceWorkspaceDependencies } from "./prepare-preview-packages"

test("replaces workspace dependencies with publishable versions", () => {
  expect(
    replaceWorkspaceDependencies(
      {
        name: "@highstate/designer",
        dependencies: {
          "@highstate/backend": "workspace:*",
          nuxt: "4.3.1",
        },
        optionalDependencies: { "@highstate/mcp": "workspace:^" },
        peerDependencies: { "@highstate/contract": "workspace:~" },
      },
      new Map([
        ["@highstate/backend", "0.30.3"],
        ["@highstate/mcp", "0.30.3"],
        ["@highstate/contract", "0.30.3"],
      ]),
      "0.0.0-preview-abc1234",
    ),
  ).toEqual({
    name: "@highstate/designer",
    version: "0.0.0-preview-abc1234",
    dependencies: {
      "@highstate/backend": "0.30.3",
      nuxt: "4.3.1",
    },
    optionalDependencies: { "@highstate/mcp": "0.30.3" },
    peerDependencies: { "@highstate/contract": "0.30.3" },
  })
})

test("rejects workspace dependencies without a package version", () => {
  expect(() =>
    replaceWorkspaceDependencies(
      { dependencies: { "@highstate/missing": "workspace:*" } },
      new Map(),
      "0.0.0-preview-abc1234",
    ),
  ).toThrow('Unable to resolve workspace dependency "@highstate/missing"')
})
