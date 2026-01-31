import { promises as fs } from "node:fs"
import * as path from "node:path"
import * as process from "node:process"
import { chromium, type Page } from "playwright"

type PreviewType = "snippets" | "blueprints"

const baseUrl = "http://localhost:3000"
const settleMs = 10000

async function main(): Promise<void> {
  const packageRoot = process.cwd()
  const snippetsDir = path.join(packageRoot, "app", "snippets")

  const snippetIds = await collectIds(snippetsDir, ".preview.ts")
  const blueprintIds = await collectIds(snippetsDir, ".blueprint.json")

  const chromiumPath = process.env.CHROMIUM_PATH
  if (chromiumPath) {
    console.log(`[thumbnails] Using custom Chromium path: ${chromiumPath}`)
  }

  await new Promise(resolve => setTimeout(resolve, 1000))

  const browser = await chromium.launch({ executablePath: chromiumPath })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" })

  try {
    await renderAll(page, "snippets", snippetIds)
    await renderAll(page, "blueprints", blueprintIds)
  } finally {
    await page.close()
    await browser.close()
  }
}

async function renderAll(
  page: Page,
  type: PreviewType,
  ids: string[],
): Promise<void> {
  const packageRoot = process.cwd()
  const outRoot = path.join(packageRoot, "public", "thumbnails", type)

  for (const id of ids) {
    const outPath = path.join(outRoot, `${id}.png`)
    const exists = await fileExists(outPath)
    if (exists) {
      console.log(`[thumbnails] ${type}: ${id} (skipped, already exists)`)
      continue
    }

    const encodedId = encodeBase64Url(id)
    const routeType = type === "snippets" ? "snippet" : "blueprint"
    const url = new URL(`/preview/${routeType}/${encodedId}`, baseUrl).toString()

    console.log(`[thumbnails] ${type}: ${id} (${url})`)

    await page.goto(url)
    await page.waitForTimeout(settleMs)
    await fs.mkdir(path.dirname(outPath), { recursive: true })

    await page.screenshot({
      path: outPath,
      type: "png",
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function encodeBase64Url(value: string): string {
  const base64 = Buffer.from(value, "utf8").toString("base64")

  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

await main()
