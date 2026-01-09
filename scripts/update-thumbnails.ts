import { promises as fs } from "node:fs"
import path from "node:path"
import process from "node:process"
import { chromium } from "playwright"

type PreviewType = "snippets" | "blueprints"

type Options = {
  baseUrl: string
  settleMs: number
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const repoRoot = process.cwd()
  const snippetsDir = path.join(repoRoot, "packages", "platform", "docs", "app", "snippets")

  const snippetIds = await collectIds(snippetsDir, ".preview.ts")
  const blueprintIds = await collectIds(snippetsDir, ".blueprint.json")

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } })

  try {
    await renderAll(page, options, "snippets", snippetIds)
    await renderAll(page, options, "blueprints", blueprintIds)
  } finally {
    await page.close()
    await browser.close()
  }
}

function parseArgs(args: string[]): Options {
  let baseUrl = "http://localhost:3000"
  let settleMs = 1000

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === "--baseUrl") {
      baseUrl = args[i + 1] ?? baseUrl
      i++
      continue
    }

    if (arg === "--settleMs") {
      const raw = args[i + 1]
      if (raw) {
        const parsed = Number.parseInt(raw, 10)
        if (!Number.isNaN(parsed)) {
          settleMs = parsed
        }
      }
      i++
      continue
    }
  }

  return { baseUrl, settleMs }
}

async function renderAll(
  page: import("playwright").Page,
  options: Options,
  type: PreviewType,
  ids: string[],
): Promise<void> {
  const repoRoot = process.cwd()
  const outRoot = path.join(repoRoot, "assets", "previews", type)

  for (const id of ids) {
    const encodedId = encodeBase64Url(id)
    const routeType = type === "snippets" ? "snippet" : "blueprint"
    const url = new URL(`/preview/${routeType}/${encodedId}`, options.baseUrl).toString()

    console.log(`[thumbnails] ${type}: ${id}`)

    await page.goto(url, { waitUntil: "networkidle" })
    await page.waitForTimeout(options.settleMs)

    const outPath = path.join(outRoot, `${id}.png`)
    await fs.mkdir(path.dirname(outPath), { recursive: true })

    await page.screenshot({
      path: outPath,
      type: "png",
      clip: { x: 0, y: 0, width: 600, height: 400 },
    })
  }
}

async function collectIds(rootDir: string, suffix: string): Promise<string[]> {
  const files = await collectFiles(rootDir)

  const ids = files
    .filter(file => file.endsWith(suffix))
    .map(file => {
      const relative = path.relative(rootDir, file)
      const normalized = relative.split(path.sep).join("/")
      return normalized.slice(0, -suffix.length)
    })
    .sort((a, b) => a.localeCompare(b))

  return ids
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue
    }

    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath)))
      continue
    }

    if (entry.isFile()) {
      results.push(fullPath)
    }
  }

  return results
}

function encodeBase64Url(value: string): string {
  const base64 = Buffer.from(value, "utf8").toString("base64")
  
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

await main()
