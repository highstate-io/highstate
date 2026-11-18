import { expect, test } from "vitest"
import { sourceRoot } from "./source-root"

test("discovers source roots across direct, grouped, and generated package layouts", () => {
  expect(sourceRoot("packages/e2e/src/harness/designer.ts")).toBe("packages/e2e")

  expect(sourceRoot("packages/platform/backend/src/library/local.ts")).toBe(
    "packages/platform/backend",
  )

  expect(sourceRoot("packages/standard/envoy/generated/protocol/src/index.ts")).toBe(
    "packages/standard/envoy/generated/protocol",
  )

  expect(sourceRoot("packages/e2e/tsconfig.json")).toBeUndefined()
  expect(sourceRoot("scripts/style/src/index.ts")).toBeUndefined()
})
