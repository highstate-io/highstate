const fs = require("node:fs")

const COMMENT_MARKER = "<!-- highstate-pr-preview-comment -->"

module.exports = async ({ github, context }) => {
  const packageMetadata = fs.readFileSync("metadata/package-metadata.json", "utf8")
  const packages = JSON.parse(packageMetadata).packages
  const images = JSON.parse(fs.readFileSync("metadata/published-images.json", "utf8")).images
  const trustedPackages = new Map()

  for (const group of ["platform", "standard", "third-party"]) {
    const directories = [`trusted/packages/${group}`]
    while (directories.length > 0) {
      const directory = directories.pop()
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          directories.push(`${directory}/${entry.name}`)
        }
      }

      const path = `${directory}/package.json`
      if (fs.existsSync(path)) {
        const manifest = JSON.parse(fs.readFileSync(path, "utf8"))
        if (manifest.name && !manifest.private) {
          trustedPackages.set(manifest.name, manifest.version)
        }
      }
    }
  }

  for (const pkg of packages) {
    if (!trustedPackages.has(pkg.name)) {
      throw new Error(`Untrusted package name: ${pkg.name}`)
    }

    const url = new URL(pkg.url)
    if (url.protocol !== "https:" || url.hostname !== "pkg.pr.new") {
      throw new Error(`Untrusted package URL: ${pkg.url}`)
    }
  }

  for (const [name, image] of Object.entries(images)) {
    if (
      !image.startsWith("ghcr.io/highstate-io/dev/") ||
      !image.includes(`:pr-${context.issue.number}@sha256:`)
    ) {
      throw new Error(`Untrusted image reference: ${name}=${image}`)
    }
  }

  const descriptor = {
    schemaVersion: 1,
    repository: "highstate-io/highstate",
    pullRequest: context.issue.number,
    sourceSha: process.env.SOURCE_SHA,
    stable: {
      platformVersion: trustedPackages.get("@highstate/pulumi"),
      stdlibVersion: trustedPackages.get("@highstate/library"),
      pulumiVersion: JSON.parse(
        fs.readFileSync("trusted/packages/platform/pulumi/package.json", "utf8"),
      ).dependencies["@pulumi/pulumi"],
    },
    packages: Object.fromEntries(packages.map(pkg => [pkg.name, pkg.url])),
  }
  const packageRows =
    packages.map(pkg => `| \`${pkg.name}\` | \`${pkg.url}\` |`).join("\n") || "| none | |"
  const imageRows = Object.entries(images)
    .map(([name, image]) => `| \`${name}\` | \`${image}\` |`)
    .join("\n")
  const body = `${COMMENT_MARKER}
## Highstate PR Preview

Install all affected packages with \`highstate update --pr ${context.issue.number}\`.

<details>
<summary>Packages</summary>

| Package | Preview URL |
|---|---|
${packageRows}

</details>

<details>
<summary>Images</summary>

| Image | Reference |
|---|---|
${imageRows}

</details>

<!-- highstate-pr-preview
${JSON.stringify(descriptor)}
-->`
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo,
    issue_number: context.issue.number,
  })
  const existing = comments.find(
    comment => comment.user?.login === "github-actions[bot]" && comment.body?.includes(COMMENT_MARKER),
  )

  if (existing) {
    await github.rest.issues.updateComment({
      ...context.repo,
      comment_id: existing.id,
      body,
    })
    return
  }

  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: context.issue.number,
    body,
  })
}
