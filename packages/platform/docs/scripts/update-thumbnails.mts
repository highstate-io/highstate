import { spawn, type ChildProcess } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import * as process from "node:process"
import { chromium, type Page } from "playwright"

type PreviewType = "snippets" | "blueprints"

const serverHost = "127.0.0.1"
const serverPort = process.env.THUMBNAIL_PORT ?? "4174"
const baseUrl = `http://${serverHost}:${serverPort}`
const settleMs = 10000
const force = process.argv.includes("--force")
const filter = readArgument("--filter")

async function main(): Promise<void> {
  const packageRoot = process.cwd()
  const snippetsDir = path.join(packageRoot, "app", "snippets")

  const snippetIds = filterIds(await collectIds(snippetsDir, ".preview.ts"))
  const blueprintIds = filterIds(await collectIds(snippetsDir, ".blueprint.json"))

  const chromiumPath = process.env.CHROMIUM_PATH
  if (chromiumPath) {
    console.log(`[thumbnails] Using custom Chromium path: ${chromiumPath}`)
  }

  await buildDocs(packageRoot)
  const server = startServer(packageRoot)

  try {
    await waitForServer()

    const browser = await chromium.launch({ executablePath: chromiumPath })
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" })

    try {
      await renderAll(page, "snippets", snippetIds)
      await renderAll(page, "blueprints", blueprintIds)
    } finally {
      await page.close()
      await browser.close()
    }
  } finally {
    await stopServer(server)
  }
}

async function buildDocs(packageRoot: string): Promise<void> {
  const designerRoot = path.resolve(packageRoot, "../designer")

  console.log("[thumbnails] Preparing Designer layer")
  await run("bunx", ["nuxi", "prepare"], designerRoot)

  console.log("[thumbnails] Cleaning generated Nuxt files")
  await Promise.all([
    fs.rm(path.join(packageRoot, ".nuxt"), { recursive: true, force: true }),
    fs.rm(path.join(packageRoot, ".output"), { recursive: true, force: true }),
    fs.rm(path.join(packageRoot, "node_modules", ".cache", "nuxt"), { recursive: true, force: true }),
  ])

  console.log("[thumbnails] Building production documentation server")
  await run("bunx", ["nuxi", "build"], packageRoot)
}

function startServer(packageRoot: string): ChildProcess {
  console.log("[thumbnails] Starting production documentation server")

  return spawn("bun", ["run", ".output/server/index.mjs"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      HOST: serverHost,
      PORT: serverPort,
    },
    stdio: "inherit",
  })
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) {
        return
      }
    } catch {
      // The production server is still starting.
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error(`Documentation server did not become ready at ${baseUrl}`)
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) {
    return
  }

  server.kill("SIGTERM")
  await new Promise<void>(resolve => {
    server.once("exit", () => resolve())
    setTimeout(resolve, 5000)
  })
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const child = spawn(command, args, { cwd, stdio: "inherit" })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}`)
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
    if (exists && !force) {
      console.log(`[thumbnails] ${type}: ${id} (skipped, already exists)`)
      continue
    }

    const encodedId = encodeBase64Url(id)
    const routeType = type === "snippets" ? "snippet" : "blueprint"
    const url = new URL(`/preview/${routeType}/${encodedId}`, baseUrl).toString()

    console.log(`[thumbnails] ${type}: ${id} (${url})`)

    const browserErrors: string[] = []
    const onPageError = (error: Error): void => {
      browserErrors.push(error.message)
    }
    page.on("pageerror", onPageError)

    await page.addInitScript(() => {
      window.addEventListener("message", event => {
        if (event.data?.type === "preview-ready") {
          window.__previewId = event.data.snippetId ?? event.data.blueprintId
        }
      })
    })
    await page.goto(url, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      expectedId => document.body.innerText.includes("is not found") || window.__previewId === expectedId,
      id,
      { timeout: 30000 },
    )
    await page.waitForTimeout(settleMs)

    const missing = await page.getByText("is not found.", { exact: false }).count()
    page.off("pageerror", onPageError)

    if (missing > 0) {
      throw new Error(`Preview ${type}/${id} was not included in the production build`)
    }
    if (browserErrors.length > 0) {
      throw new Error(`Preview ${type}/${id} failed: ${browserErrors.join("; ")}`)
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true })

    await page.screenshot({
      path: outPath,
      type: "png",
    })
  }
}

declare global {
  interface Window {
    __previewId?: string
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

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return undefined
  }

  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }

  return value
}

function filterIds(ids: string[]): string[] {
  return filter ? ids.filter(id => id.startsWith(filter)) : ids
}

function encodeBase64Url(value: string): string {
  const base64 = Buffer.from(value, "utf8").toString("base64")

  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

await main()
