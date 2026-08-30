import { describe, expect, test } from "vitest"
import { parsePrPreviewComment } from "./pr-preview"

const descriptor = {
  schemaVersion: 1,
  repository: "highstate-io/highstate",
  pullRequest: 12,
  sourceSha: "a".repeat(40),
  stable: { platformVersion: "0.29.0", stdlibVersion: "0.27.0", pulumiVersion: "3.232.0" },
  packages: { "@highstate/k8s": "https://pkg.pr.new/highstate-io/highstate/k8s@abc1234" },
}

describe("parsePrPreviewComment", () => {
  test("accepts the trusted bot descriptor", () => {
    expect(
      parsePrPreviewComment(
        {
          user: { login: "github-actions[bot]", type: "Bot" },
          body: `preview\n<!-- highstate-pr-preview\n${JSON.stringify(descriptor)}\n-->`,
        },
        12,
      ),
    ).toEqual(descriptor)
  })

  test("ignores comments from other authors", () => {
    expect(
      parsePrPreviewComment(
        {
          user: { login: "contributor", type: "User" },
          body: `<!-- highstate-pr-preview\n${JSON.stringify(descriptor)}\n-->`,
        },
        12,
      ),
    ).toBeNull()
  })

  test("rejects package URLs outside pkg.pr.new", () => {
    expect(() =>
      parsePrPreviewComment(
        {
          user: { login: "github-actions[bot]", type: "Bot" },
          body: `<!-- highstate-pr-preview\n${JSON.stringify({
            ...descriptor,
            packages: { "@highstate/k8s": "https://example.com/package.tgz" },
          })}\n-->`,
        },
        12,
      ),
    ).toThrow("invalid URL")
  })
})
