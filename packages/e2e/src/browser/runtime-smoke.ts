import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect as baseExpect, chromium, type Request } from "@playwright/test"
import { root, startDesigner } from "../harness/designer"
import { designerCall } from "../harness/designer-client"

const expect = baseExpect.configure({ timeout: 15_000 })

const evidence = join(
  root,
  ".artifacts/e2e",
  `runtime-browser-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
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
const pendingRequests = new Set<Request>()
const navigationEvents: string[] = []
let failedRequests: { type: string; host: string; path: string }[] = []

try {
  designer = await startDesigner()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on("request", request => pendingRequests.add(request))
  page.on("requestfinished", request => pendingRequests.delete(request))
  page.on("requestfailed", request => pendingRequests.delete(request))
  page.on("domcontentloaded", () => navigationEvents.push("domcontentloaded"))
  page.on("load", () => navigationEvents.push("load"))
  let operationQueries = 0
  let libraryQueries = 0
  let eventFrames = 0
  let stateBackendId = ""
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
    await expect(settings().getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
    await expect(settings().getByRole("button", { name: "Project", exact: true })).toBeDisabled()

    for (const name of [
      "Container Runtimes",
      "Pulumi State Backends",
      "npm Registry Credentials",
      "OCI Registry Credentials",
      "Backend Roles",
      "Backend Service Accounts",
      "Backend API Keys",
    ]) {
      await settings().getByRole("button", { name, exact: true }).click()
      await expect(settings().getByRole("heading", { name, exact: true })).toBeVisible()
      await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()
    }
  })

  await step("create and update a state backend through UI", async () => {
    await settings().getByRole("button", { name: "Pulumi State Backends", exact: true }).click()
    await settings().getByRole("button", { name: "Create", exact: true }).click()
    await expect(dialog().getByLabel("ID", { exact: true })).toHaveCount(0)
    await dialog().getByLabel("Title", { exact: true }).fill("Browser state")

    await dialog()
      .getByLabel("Pulumi state backend URL", { exact: true })
      .fill("file:///tmp/highstate-browser-state")

    await dialog().getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog()).toBeHidden()
    const createdRow = settings().getByRole("row").filter({ hasText: "Browser state" })
    await createdRow.getByRole("button", { name: "Edit setting", exact: true }).click()
    await expect(dialog().getByLabel("ID", { exact: true })).toHaveCount(0)

    const saved = await designerCall<{ stateBackends: { id: string; meta: { title?: string } }[] }>(
      designer!.url,
      "runtimeSettings.list",
      undefined,
    )

    stateBackendId = saved.stateBackends.find(item => item.meta.title === "Browser state")!.id
    expect(stateBackendId).toMatch(/^[a-z][a-z0-9]{23}$/)
    await expect(dialog().getByText(/revision/i)).toHaveCount(0)
    await dialog().getByLabel("Title", { exact: true }).fill("Browser state updated")
    await dialog().getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog()).toBeHidden()
    await page.reload()
    await settings().getByRole("button", { name: "Pulumi State Backends", exact: true }).click()
    const row = settings().getByRole("row").filter({ hasText: "Browser state updated" })
    await expect(row).toContainText("Browser state updated")
    await row.getByRole("button", { name: "Edit setting", exact: true }).click()

    await expect(dialog().getByLabel("Pulumi state backend URL", { exact: true })).toHaveValue(
      "file:///tmp/highstate-browser-state",
    )

    await expect(dialog().getByText(/revision/i)).toHaveCount(0)
    await expect(dialog().getByRole("button", { name: "Delete", exact: true })).toHaveCount(0)
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click()
  })

  await step("synchronize runtime settings changed by another client", async () => {
    const saved = await designerCall<{ stateBackends: { id: string; revision: string }[] }>(
      designer!.url,
      "runtimeSettings.list",
      undefined,
    )

    const revision = saved.stateBackends.find(item => item.id === stateBackendId)!.revision

    await designerCall(
      designer!.url,
      "runtimeSettings.put",
      {
        kind: "pulumi-state-backend",
        id: stateBackendId,
        value: {
          revision,
          meta: { title: "Browser state updated", description: "Changed by another client" },
          spec: { url: "file:///tmp/highstate-browser-state" },
        },
      },
      true,
    )

    await expect(
      settings().getByRole("row").filter({ hasText: "Browser state updated" }),
    ).toContainText("Changed by another client")
  })

  await step("delete saved setting through UI and verify persistence", async () => {
    await settings()
      .getByRole("row")
      .filter({ hasText: "Browser state updated" })
      .getByRole("button", { name: "Delete setting", exact: true })
      .click()

    await expect(dialog()).toContainText("Browser state updated")
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click()
    const row = settings().getByRole("row").filter({ hasText: "Browser state updated" })
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Delete setting", exact: true }).click()
    await dialog().getByRole("button", { name: "Delete", exact: true }).click()
    await expect(dialog()).toBeHidden()
    await page.reload()
    await settings().getByRole("button", { name: "Pulumi State Backends", exact: true }).click()
    await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()

    await expect(
      settings().getByRole("row").filter({ hasText: "Browser state updated" }),
    ).toHaveCount(0)
  })

  await step("create a project through UI with empty initial library", async () => {
    await page.goto(designer!.url)

    await page
      .locator(".dv-tab")
      .filter({ hasText: /^Projects$/ })
      .click()

    await page.locator(".main-menu-list").getByText("Create", { exact: true }).click()
    await dialog().getByLabel("Name", { exact: true }).fill("browser-smoke")
    await dialog().getByLabel("Title", { exact: true }).fill("Browser smoke")
    await dialog().getByRole("button", { name: "Generate Secure Password", exact: true }).click()

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

  await step("settings scopes select a project without shifting the sidebar", async () => {
    await page.goto(`${designer!.url}/settings/project-list`)
    const projectsEntry = settings().getByRole("button", { name: "Projects", exact: true })
    await expect(projectsEntry).toBeVisible()
    const entryBounds = await projectsEntry.boundingBox()
    const projectTab = settings().getByRole("button", { name: "Project", exact: true })
    await expect(projectTab).toBeEnabled()
    await projectTab.click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${projectId}/`))
    const selector = settings().locator(".project-selector")
    await expect(selector).toContainText("Browser smoke")
    expect(await selector.locator(".v-field").boundingBox()).toEqual(entryBounds)

    await settings()
      .getByRole("group", { name: "Security", exact: true })
      .getByRole("button", { name: "Roles", exact: true })
      .click()

    await expect(settings().getByRole("heading", { name: "Roles", exact: true })).toBeVisible()
    await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()

    await settings()
      .getByRole("group", { name: "Resources", exact: true })
      .getByRole("button", { name: "Instances", exact: true })
      .click()

    await expect(settings().getByRole("heading", { name: "Instances", exact: true })).toBeVisible()
    await settings().getByRole("button", { name: "Backend", exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/project-list$/)
    await expect(projectsEntry).toBeVisible()
    expect(await projectsEntry.boundingBox()).toEqual(entryBounds)
  })

  await step("settings scopes preserve an explicitly chosen project", async () => {
    await page.goto(designer!.url)

    await page
      .locator(".dv-tab")
      .filter({ hasText: /^Projects$/ })
      .click()

    await page.locator(".main-menu-list").getByText("Create", { exact: true }).click()
    await dialog().getByLabel("Name", { exact: true }).fill("alternate-project")
    await dialog().getByLabel("Title", { exact: true }).fill("Alternate project")
    await dialog().getByRole("button", { name: "Generate Secure Password", exact: true }).click()
    await dialog().getByRole("button", { name: "Create", exact: true }).click()
    await expect(dialog()).toBeHidden({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/projects\/[^/]+/)
    const alternateId = new URL(page.url()).pathname.split("/")[2]
    await page.goto(`${designer!.url}/settings/projects/${projectId}/operations`)
    await settings().locator(".project-selector .v-field").click()
    await page.getByRole("option", { name: "Alternate project", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${alternateId}/operations$`))
    await settings().getByRole("button", { name: "Backend", exact: true }).click()
    await settings().getByRole("button", { name: "Project", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${alternateId}/operations$`))
    await expect(settings().locator(".project-selector")).toContainText("Alternate project")
  })

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
      await row.getByRole("button", { name: "Edit project", exact: true }).click()
      await expect(dialog().getByLabel("Container runtime", { exact: true })).toBeVisible()
      await expect(dialog().getByLabel("Pulumi state backend", { exact: true })).toBeVisible()
      await dialog().getByRole("button", { name: "Cancel", exact: true }).click()
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
  failedRequests = [...pendingRequests].map(request => ({
    type: request.resourceType(),
    host: new URL(request.url()).hostname,
    path: new URL(request.url()).pathname,
  }))

  console.error("Browser navigation diagnostics", { navigationEvents, pending: failedRequests })

  if (activeStep === "fresh production app and runtime settings") {
    console.error("Fresh Designer startup log", designer?.logs())
  }

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
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify({ status, steps, faults, navigationEvents, failedRequests }, null, 2),
  )

  console.log(`Evidence: ${evidence}`)
}
