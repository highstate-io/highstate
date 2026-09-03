import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { getGitHubToken, parsePrPreviewComment } from "./pr-preview"

const descriptor = {
  schemaVersion: 1,
  repository: "highstate-io/highstate",
  pullRequest: 12,
  sourceSha: "a".repeat(40),
  stable: {
    platformVersion: "0.29.0",
    stdlibVersion: "0.27.0",
    pulumiVersion: "3.232.0",
  },
  packages: {
    "@highstate/k8s": "https://pkg.pr.new/highstate-io/highstate/@highstate/k8s@abc1234",
  },
}

const originalGitHubToken = process.env.GITHUB_TOKEN
const originalGhToken = process.env.GH_TOKEN

afterEach(() => {
  setEnvironmentVariable("GITHUB_TOKEN", originalGitHubToken)
  setEnvironmentVariable("GH_TOKEN", originalGhToken)
})

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

  test("accepts all Highstate package previews", () => {
    const packages = {
      "create-highstate": "https://pkg.pr.new/highstate-io/highstate/create-highstate@abc1234",
      "@highstate/generated-sdk":
        "https://pkg.pr.new/highstate-io/highstate/@highstate/generated-sdk@abc1234",
    }

    expect(
      parsePrPreviewComment(
        {
          user: { login: "github-actions[bot]", type: "Bot" },
          body: `<!-- highstate-pr-preview\n${JSON.stringify({ ...descriptor, packages })}\n-->`,
        },
        12,
      ),
    ).toEqual({ ...descriptor, packages })
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

  test("rejects a preview URL for a different package", () => {
    expect(() =>
      parsePrPreviewComment(
        {
          user: { login: "github-actions[bot]", type: "Bot" },
          body: `<!-- highstate-pr-preview\n${JSON.stringify({
            ...descriptor,
            packages: {
              "@highstate/k8s":
                "https://pkg.pr.new/highstate-io/highstate/@highstate/contract@abc1234",
            },
          })}\n-->`,
        },
        12,
      ),
    ).toThrow("invalid URL")
  })
})

describe("getGitHubToken", () => {
  test("uses an environment token without invoking gh", async () => {
    process.env.GH_TOKEN = " gh-token "
    process.env.GITHUB_TOKEN = "github-token"

    await expect(getGitHubToken("missing-gh-command")).resolves.toBe("gh-token")
  })

  test("uses the authenticated gh CLI token", async () => {
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    const directory = await mkdtemp(join(tmpdir(), "highstate-gh-"))
    const commandPath = join(directory, "gh")

    try {
      await writeFile(commandPath, '#!/bin/sh\nprintf "stored-token\\n"\n')
      await chmod(commandPath, 0o755)

      await expect(getGitHubToken(commandPath)).resolves.toBe("stored-token")
    } finally {
      await rm(directory, { recursive: true })
    }
  })

  test("allows anonymous access when gh authentication is unavailable", async () => {
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN

    await expect(getGitHubToken("missing-gh-command")).resolves.toBeUndefined()
  })
})

function setEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
