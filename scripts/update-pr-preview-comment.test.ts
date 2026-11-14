import fs from "node:fs"
import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const updatePreviewComment = createRequire(import.meta.url)(
  "../.github/scripts/update-pr-preview-comment.cjs",
)
const { renderPreviewComment } = updatePreviewComment
const packages = [{ name: "@highstate/contract", url: "https://pkg.pr.new/example" }]
const images = { ssh: `ghcr.io/highstate-io/dev/terminal.ssh:pr-72@sha256:${"a".repeat(64)}` }
const descriptor = { schemaVersion: 1, pullRequest: 72, packages: {} }

afterEach(() => vi.restoreAllMocks())

test("explains an empty preview without install instructions or empty tables", () => {
  const body = renderPreviewComment({ packages: [], images: {}, descriptor, pullRequest: 72 })
  expect(body).toContain("No packages or images are affected by this pull request.")
  expect(body).not.toContain("highstate update")
  expect(body).not.toContain("<details>")
  expect(body).toContain(`<!-- highstate-pr-preview\n${JSON.stringify(descriptor)}\n-->`)
})

test("shows image-only previews without package installation instructions", () => {
  const body = renderPreviewComment({ packages: [], images, descriptor, pullRequest: 72 })
  expect(body).toContain("No packages are affected by this pull request.")
  expect(body).toContain("<summary>Images</summary>")
  expect(body).toContain(images.ssh)
  expect(body).not.toContain("<summary>Packages</summary>")
  expect(body).not.toContain("highstate update")
})

test.each([{}, images])("keeps install instructions for package previews", imageMetadata => {
  const body = renderPreviewComment({
    packages,
    images: imageMetadata,
    descriptor,
    pullRequest: 72,
  })

  expect(body).toContain("highstate update --pr 72")
  expect(body).toContain("<summary>Packages</summary>")
  expect(body).toContain(packages[0].url)
  expect(body.includes("<summary>Images</summary>")).toBe(Object.keys(imageMetadata).length > 0)
})

test("replaces a previous populated bot comment when the preview becomes empty", async () => {
  vi.spyOn(fs, "readdirSync").mockReturnValue([])
  vi.spyOn(fs, "existsSync").mockReturnValue(false)

  vi.spyOn(fs, "readFileSync").mockImplementation(path => {
    switch (path) {
      case "metadata/package-metadata.json":
        return JSON.stringify({ packages: [] })
      case "metadata/published-images.json":
        return JSON.stringify({ images: {} })
      case "trusted/packages/platform/pulumi/package.json":
        return JSON.stringify({ dependencies: { "@pulumi/pulumi": "^3.0.0" } })
    }

    throw new Error(`Unexpected file: ${path}`)
  })

  const updateComment = vi.fn()
  const createComment = vi.fn()

  const github = {
    paginate: vi.fn().mockResolvedValue([
      {
        id: 9,
        user: { login: "github-actions[bot]" },
        body: "<!-- highstate-pr-preview-comment -->\nold packages",
      },
    ]),
    rest: { issues: { listComments: vi.fn(), updateComment, createComment } },
  }

  const repo = { owner: "highstate-io", repo: "highstate" }
  await updatePreviewComment({ github, context: { repo, issue: { ...repo, number: 72 } } })

  expect(updateComment).toHaveBeenCalledWith({
    ...repo,
    comment_id: 9,
    body: expect.stringContaining("No packages or images are affected by this pull request."),
  })

  expect(updateComment.mock.calls[0][0].body).not.toContain("highstate update")
  expect(createComment).not.toHaveBeenCalled()
})
