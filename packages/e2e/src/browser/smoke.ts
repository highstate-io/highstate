import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect as baseExpect, chromium, type Locator, type Page } from "@playwright/test"
import { root, startDesigner } from "./designer"

const expect = baseExpect.configure({ timeout: 15_000 })

async function select(page: Page, scope: Page | Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label, exact: true }).press("Enter")
  await page.getByRole("option", { name: option, exact: true }).click()
}

const evidence = join(
  root,
  ".artifacts/e2e",
  `browser-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
)
await mkdir(evidence, { recursive: true })
const steps: { name: string; status: string; durationMs: number }[] = []
let activeStep = "production startup"
let started = Date.now()
const step = async (name: string, action: () => Promise<void>, required = true) => {
  activeStep = name
  started = Date.now()

  try {
    await action()
    steps.push({ name, status: "passed", durationMs: Date.now() - started })
    console.log(`PASS ${name}`)
  } catch (error) {
    steps.push({ name, status: "failed", durationMs: Date.now() - started })
    console.error(`FAIL ${name}`)

    if (required) {
      throw error
    }

    console.error(error)
  }
}

let designer: Awaited<ReturnType<typeof startDesigner>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const faults: string[] = []
try {
  designer = await startDesigner()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  let operationQueries = 0
  let libraryQueries = 0
  let eventFrames = 0
  page.on("pageerror", error => faults.push(error.name))

  page.on("console", message => {
    if (message.type() === "error") {
      faults.push(
        message.text().includes('/catalog" found') ? "catalog store missing" : "console.error",
      )
    }
  })

  page.on("response", response => {
    const path = new URL(response.url()).pathname

    if (response.status() >= 400) {
      faults.push(`HTTP ${response.status()}`)
    }

    if (response.ok() && path.includes("operationSettings.query")) {
      operationQueries++
    }

    if (response.ok() && path.includes("library.getProjectLibrary")) {
      libraryQueries++
    }
  })

  page.on("websocket", socket => {
    socket.on("socketerror", () => faults.push("WebSocket error"))
    socket.on("framereceived", () => eventFrames++)
  })

  const settings = () => page.locator(".data-settings-panel")
  const dialog = () => page.getByRole("dialog")

  await step("fresh production app and runtime settings", async () => {
    await page.goto(designer!.url)
    await page.getByText("Data & Settings", { exact: true }).click()
    await settings().getByRole("button", { name: "Runtime & Registries", exact: true }).click()
    await expect(settings().getByRole("heading", { name: "Runtime & Registries" })).toBeVisible()
    await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()
  })

  await step("create and update a state backend through UI", async () => {
    await select(page, settings(), "Settings category", "Pulumi state backends")
    await settings().getByRole("button", { name: "Create", exact: true }).click()
    await dialog().getByLabel("ID", { exact: true }).fill("browser-state")
    await dialog().getByLabel("Title", { exact: true }).fill("Browser state")

    await dialog()
      .getByLabel("Pulumi state backend URL", { exact: true })
      .fill("file:///tmp/highstate-browser-state")

    await dialog().getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog().getByText("Revision 1", { exact: true })).toBeVisible()
    await dialog().getByLabel("Title", { exact: true }).fill("Browser state updated")
    await dialog().getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog().getByText("Revision 2", { exact: true })).toBeVisible()
    await dialog().getByRole("button", { name: "Close", exact: true }).click()
    await page.reload()
    await select(page, settings(), "Settings category", "Pulumi state backends")
    const row = settings().getByRole("row").filter({ hasText: "browser-state" })
    await expect(row).toContainText("Browser state updated")
    await row.getByRole("button", { name: "Edit", exact: true }).click()

    await expect(dialog().getByLabel("Pulumi state backend URL", { exact: true })).toHaveValue(
      "file:///tmp/highstate-browser-state",
    )

    await expect(dialog().getByText("Revision 2", { exact: true })).toBeVisible()
    await dialog().getByRole("button", { name: "Close", exact: true }).click()
  })

  await step("delete saved setting through UI and verify persistence", async () => {
    await settings()
      .getByRole("row")
      .filter({ hasText: "browser-state" })
      .getByRole("button", { name: "Edit", exact: true })
      .click()

    await dialog().getByRole("button", { name: "Delete", exact: true }).click()
    await dialog().getByRole("button", { name: "Confirm delete", exact: true }).click()
    await expect(dialog()).toBeHidden()
    await page.reload()
    await select(page, settings(), "Settings category", "Pulumi state backends")
    await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()
    await expect(settings().getByRole("row").filter({ hasText: "browser-state" })).toHaveCount(0)
  })

  await step("create a project through UI with empty initial library", async () => {
    await page.goto(designer!.url)

    await page
      .locator(".dv-tab")
      .filter({ hasText: /^Projects$/ })
      .click()

    await page.getByText("Create new project", { exact: true }).click()
    await dialog().getByLabel("Name", { exact: true }).fill("browser-smoke")
    await dialog().getByLabel("Title", { exact: true }).fill("Browser smoke")
    await dialog().getByLabel("Password", { exact: true }).fill("Browser-Smoke-Disposable-84!cedar")

    await dialog()
      .getByLabel("Confirm Password", { exact: true })
      .fill("Browser-Smoke-Disposable-84!cedar")

    await dialog().getByRole("button", { name: "Create", exact: true }).click()
    await expect(dialog()).toBeHidden({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/projects\/[^/]+/)
  })

  const projectId = new URL(page.url()).pathname.split("/")[2]
  expect(projectId).toBeTruthy()

  await step(
    "project package controls load the empty library",
    async () => {
      await page.getByRole("button", { name: "Manage project library", exact: true }).click()

      await expect(
        dialog().getByRole("heading", { name: "Project library", exact: true }),
      ).toBeVisible()

      await expect(dialog().getByText("No packages selected.", { exact: true })).toBeVisible()
      expect(libraryQueries).toBeGreaterThan(0)
      await expect(dialog().getByRole("button", { name: "Update all", exact: true })).toBeDisabled()

      await expect(
        dialog().getByRole("button", { name: "Add package", exact: true }),
      ).toBeDisabled()

      await expect(
        dialog().getByRole("button", { name: "List versions", exact: true }),
      ).toBeDisabled()

      await dialog().getByLabel("npm package name", { exact: true }).fill("@highstate/library")

      await expect(
        dialog().getByRole("button", { name: "List versions", exact: true }),
      ).toBeEnabled()

      await expect(
        dialog().getByRole("button", { name: "Add package", exact: true }),
      ).toBeDisabled()

      await dialog()
        .getByRole("combobox", { name: "Exact version (for example 1.2.3)", exact: true })
        .fill("0.30.2")

      await expect(dialog().getByRole("button", { name: "Add package", exact: true })).toBeEnabled()
      await dialog().getByRole("button", { name: "Close library", exact: true }).click()
    },
    false,
  )

  await step(
    "operation panel disables auto update for the empty project",
    async () => {
      await expect(
        page.getByRole("button", { name: /auto update.*nothing to update/i }),
      ).toBeDisabled()
    },
    false,
  )

  await step(
    "project operation history route loads real empty results",
    async () => {
      await page.goto(`${designer!.url}/settings/projects/${projectId}/operations`)
      await settings().getByRole("button", { name: "Operations", exact: true }).click()

      await expect(
        settings().getByText("Manage and monitor operations executed within this project.", {
          exact: true,
        }),
      ).toBeVisible()

      await expect(settings().getByText("No data available", { exact: true })).toBeVisible()
      await expect.poll(() => operationQueries).toBeGreaterThan(0)
      await page.reload()
      await expect(settings().getByText("No data available", { exact: true })).toBeVisible()
    },
    false,
  )

  await step(
    "created project persists in global settings",
    async () => {
      await page.goto(`${designer!.url}/settings/project-list`)
      await settings().getByRole("button", { name: "Projects", exact: true }).click()
      const row = settings().getByRole("row").filter({ hasText: "Browser smoke" })
      await expect(row).toContainText(projectId!.slice(0, 8))
      await expect(row.getByRole("button", { name: "Placement", exact: true })).toBeVisible()
    },
    false,
  )

  await step(
    "browser has no runtime, HTTP, or event errors",
    async () => {
      expect(eventFrames).toBeGreaterThan(0)
      expect(faults).toEqual([])
    },
    false,
  )
} catch (error) {
  if (steps.at(-1)?.name !== activeStep) {
    steps.push({ name: activeStep, status: "failed", durationMs: Date.now() - started })
  }

  console.error(error)
  process.exitCode = 1
} finally {
  await step(
    "cleanup production process and disposable state",
    async () => {
      try {
        await browser?.close()
      } finally {
        await designer?.stop()
      }
    },
    false,
  )

  const status = steps.some(step => step.status === "failed") ? "failed" : "passed"
  if (status === "failed") {
    process.exitCode = 1
  }

  // publish only metadata; Playwright errors can include form values or response bodies
  await writeFile(join(evidence, "result.json"), JSON.stringify({ status, steps, faults }, null, 2))
  console.log(`Evidence: ${evidence}`)
}
