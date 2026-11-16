import { readFile, realpath, writeFile } from "node:fs/promises"

export type PrismaStyleIssue = {
  line: number
  message: string
}

/**
 * Checks field documentation and spacing without changing schema declarations or comments.
 */
export function checkPrismaSource(source: string, fix = false) {
  const lines = source.split("\n")
  const issues: PrismaStyleIssue[] = []
  const insertions = new Set<number>()
  let block: string | undefined
  let opening = -1
  let comment = false

  for (const [index, line] of lines.entries()) {
    const text = line.trim()

    if (comment) {
      comment = !text.includes("*/")
      continue
    }

    if (text.startsWith("/*")) {
      comment = !text.includes("*/")
      continue
    }

    if (!text || text.startsWith("//")) {
      continue
    }

    const declaration = /^(model|enum|type|view)\s+(\w+)\s*\{\s*$/.exec(text)
    if (declaration) {
      block = declaration[2]
      opening = index
      continue
    }

    if (text === "}") {
      block = undefined
      continue
    }

    if (!block || !/^\w/.test(text)) {
      continue
    }

    let start = index

    while (start > opening + 1 && lines[start - 1].trim().startsWith("///")) {
      start--
    }

    const documented = lines.slice(start, index).some(value => {
      const description = value.trim().slice(3).trim()
      return description.length > 0 && !/^!?\[.*\]$/.test(description)
    })

    if (!documented) {
      issues.push({ line: index + 1, message: `Document ${block}.${text.split(/\s/)[0]} with ///` })
    }

    let spacingStart = start

    while (spacingStart > opening + 1 && lines[spacingStart - 1].trim().startsWith("//")) {
      spacingStart--
    }

    if (spacingStart > opening + 1 && lines[spacingStart - 1].trim() !== "") {
      if (fix) {
        insertions.add(spacingStart)
      } else {
        issues.push({ line: spacingStart + 1, message: "Separate Prisma fields with a blank line" })
      }
    }
  }

  return {
    issues,
    source: lines
      .flatMap((line, index) => (insertions.has(index) ? ["", line] : [line]))
      .join("\n"),
  }
}

/**
 * Includes all workspace schemas and checks symlinked backend variants only once.
 */
export async function checkPrismaSchemas(fix = false): Promise<boolean> {
  const paths = new Set<string>()

  for await (const path of new Bun.Glob("packages/**/*.prisma").scan()) {
    if (!path.includes("/node_modules/") && !path.includes("/_generated/")) {
      paths.add(await realpath(path))
    }
  }

  let passed = true

  for (const path of [...paths].sort()) {
    const source = await readFile(path, "utf8")
    const result = checkPrismaSource(source, fix)

    if (fix && result.source !== source) {
      await writeFile(path, result.source)
    }

    for (const issue of result.issues) {
      console.error(`${path}:${issue.line}: ${issue.message}`)
      passed = false
    }
  }

  return passed
}
