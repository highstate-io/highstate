import { execFile } from "node:child_process"
import { promisify } from "node:util"
import semver from "semver"

const PREVIEW_MARKER = "highstate-pr-preview"
const execFileAsync = promisify(execFile)

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
    if (name !== "create-highstate" && !/^@highstate\/[a-z0-9.-]+$/.test(name)) {
      throw new Error(`Preview includes unknown package "${name}"`)
    }

    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "pkg.pr.new" ||
      !parsed.pathname.startsWith(`/highstate-io/highstate/${name}@`)
    ) {
      throw new Error(`Preview package "${name}" has an invalid URL`)
    }
  }

  return descriptor
}

export async function fetchPrPreviewDescriptor(pullRequest: number): Promise<PrPreviewDescriptor> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  const token = await getGitHubToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const [response, pullResponse] = await Promise.all([
    fetch(
      `https://api.github.com/repos/highstate-io/highstate/issues/${pullRequest}/comments?per_page=100`,
      { headers },
    ),
    fetch(`https://api.github.com/repos/highstate-io/highstate/pulls/${pullRequest}`, { headers }),
  ])

  if (!response.ok) {
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error(
        `Unable to fetch Highstate PR ${pullRequest} comments because the GitHub API rate limit was exceeded; run "gh auth login" or set GH_TOKEN`,
      )
    }

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

export async function getGitHubToken(commandPath = "gh"): Promise<string | undefined> {
  const environmentToken = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()
  if (environmentToken) {
    return environmentToken
  }

  try {
    const { stdout } = await execFileAsync(commandPath, [
      "auth",
      "token",
      "--hostname",
      "github.com",
    ])
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}
