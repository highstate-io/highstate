import { expect, test } from "vitest"
import { buildOverrides } from "./overrides"

test("buildOverrides uses version-specific release groups", () => {
  expect(
    buildOverrides({
      platformVersion: "0.31.0",
      stdlibVersion: "0.29.0",
      pulumiVersion: "3.232.0",
      platformPackages: ["@highstate/contract", "create-highstate"],
      stdlibPackages: ["@highstate/library", "@highstate/new-package"],
    }),
  ).toEqual({
    "@highstate/contract": "0.31.0",
    "create-highstate": "0.31.0",
    "@highstate/library": "0.29.0",
    "@highstate/new-package": "0.29.0",
    "@pulumi/pulumi": "3.232.0",
  })
})
