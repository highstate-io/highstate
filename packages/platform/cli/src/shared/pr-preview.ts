import semver from "semver"
import { PLATFORM_PACKAGES, STDLIB_PACKAGES } from "./version-sets"

const PREVIEW_MARKER = "highstate-pr-preview"
const ALLOWED_PACKAGES = new Set([...PLATFORM_PACKAGES, ...STDLIB_PACKAGES])

export type PrPreviewDescriptor = {
  schemaVersion: 1
  repository: "highstate-io/highstate"
  pullRequest: number
  sourceSha: string
  stable: {
    platformVersion: string
    stdlibVersion: string
    pulumiVersion: string
  }
  packages: Record<string, string>
}

type GitHubComment = { body?: string; user?: { login?: string; type?: string } }

export function parsePrPreviewComment(
  comment: GitHubComment,
  pullRequest: number,
): PrPreviewDescriptor | null {
  if (comment.user?.login !== "github-actions[bot]" || comment.user.type !== "Bot") {
    return null
  }

  const match = comment.body?.match(new RegExp(`<!-- ${PREVIEW_MARKER}\\n([\\s\\S]*?)\\n-->`))
  if (!match) {
    return null
  }

  const descriptor = JSON.parse(match[1]) as PrPreviewDescriptor

  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.repository !== "highstate-io/highstate" ||
    descriptor.pullRequest !== pullRequest ||
    !/^[a-f0-9]{40}$/.test(descriptor.sourceSha)
  ) {
    throw new Error("Invalid Highstate PR preview descriptor")
  }
  if (
    !semver.valid(descriptor.stable.platformVersion) ||
    !semver.valid(descriptor.stable.stdlibVersion) ||
    !semver.valid(descriptor.stable.pulumiVersion)
  ) {
    throw new Error("Highstate PR preview has invalid stable versions")
  }

  for (const [name, url] of Object.entries(descriptor.packages)) {
    if (!ALLOWED_PACKAGES.has(name)) {
      throw new Error(`Preview includes unknown package "${name}"`)
    }

    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "pkg.pr.new" ||
      !parsed.pathname.startsWith("/highstate-io/highstate/")
    ) {
      throw new Error(`Preview package "${name}" has an invalid URL`)
    }
  }

  return descriptor
}

export async function fetchPrPreviewDescriptor(pullRequest: number): Promise<PrPreviewDescriptor> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const [response, pullResponse] = await Promise.all([
    fetch(
      `https://api.github.com/repos/highstate-io/highstate/issues/${pullRequest}/comments?per_page=100`,
      { headers },
    ),
    fetch(`https://api.github.com/repos/highstate-io/highstate/pulls/${pullRequest}`, { headers }),
  ])

  if (!response.ok) {
    throw new Error(
      `Unable to fetch Highstate PR ${pullRequest} comments (HTTP ${response.status})`,
    )
  }

  if (!pullResponse.ok) {
    throw new Error(`Unable to fetch Highstate PR ${pullRequest} (HTTP ${pullResponse.status})`)
  }

  const pull = (await pullResponse.json()) as { head?: { sha?: string } }

  for (const comment of (await response.json()) as GitHubComment[]) {
    const descriptor = parsePrPreviewComment(comment, pullRequest)

    if (descriptor) {
      if (descriptor.sourceSha !== pull.head?.sha) {
        throw new Error(
          `Highstate PR ${pullRequest} preview is stale; wait for its preview workflow`,
        )
      }
      return descriptor
    }
  }

  throw new Error(`Highstate PR ${pullRequest} does not have a current preview`)
}
