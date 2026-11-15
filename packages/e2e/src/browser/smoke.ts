import type { Request } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { userInfo } from "node:os"
import { join } from "node:path"
import { expect as baseExpect } from "@playwright/test"
import { root, startDesigner } from "../harness/designer"
import { createFixtureProject } from "../harness/fixtures"
import { inspectDesigner } from "../harness/inspection"
import { launchBrowser } from "./launch"

const expect = baseExpect.configure({ timeout: 30_000 })

const evidence = join(
  root,
  ".artifacts/e2e",
  `browser-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
)

await mkdir(evidence, { recursive: true })
const steps: { name: string; status: string }[] = []

const step = async (name: string, action: () => Promise<void>) => {
  try {
    await action()
    steps.push({ name, status: "passed" })
    console.log(`PASS ${name}`)
  } catch (error) {
    steps.push({ name, status: "failed" })
    throw error
  }
}

let designer: Awaited<ReturnType<typeof startDesigner>> | undefined
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined
const faults: string[] = []
const pending = new Set<Request>()

try {
  designer = await startDesigner()
  browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(60_000)
  page.on("pageerror", error => faults.push(error.message))
  page.on("request", request => pending.add(request))
  page.on("requestfinished", request => pending.delete(request))
  page.on("requestfailed", request => pending.delete(request))

  page.on("response", response => {
    const url = new URL(response.url())
    if (url.origin === designer!.url && response.status() >= 400) {
      faults.push(`${response.status()} ${url.pathname}`)
    }
  })

  page.on("websocket", socket => socket.on("socketerror", () => faults.push("WebSocket error")))
  const settings = () => page.locator(".data-settings-panel")
  const dialog = () => page.getByRole("dialog")

  const createProject = async (name: string, title: string) => {
    await page.goto(designer!.url)

    await page
      .locator(".dv-tab")
      .filter({ hasText: /^Projects$/ })
      .click()

    await page.locator(".main-menu-list").getByText("Create", { exact: true }).click()
    await dialog().getByLabel("Name", { exact: true }).fill(name)
    await dialog().getByLabel("Title", { exact: true }).fill(title)
    await dialog().getByRole("button", { name: "Generate Secure Password", exact: true }).click()
    await dialog().getByRole("button", { name: "Create", exact: true }).click()
    await expect(dialog()).toBeHidden({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/projects\/[^/]+/)
    return new URL(page.url()).pathname.split("/")[2]!
  }

  await step(
    "fresh production settings preserve deep links and disable the project scope without projects",
    async () => {
      await page.goto(`${designer!.url}/settings/project-list`)
      await expect(settings().getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
      await expect(settings().getByRole("button", { name: "Project", exact: true })).toBeDisabled()

      for (const name of ["Backend Roles", "Backend Service Accounts", "Backend API Keys"]) {
        await settings().getByRole("button", { name, exact: true }).click()
        await expect(settings().getByRole("heading", { name, exact: true })).toBeVisible()
        await expect(settings().getByRole("button", { name: "Create", exact: true })).toBeEnabled()
      }
    },
  )

  await step(
    "local account uses the OS username and UID without repeating its display name",
    async () => {
      const user = userInfo()
      const account = page.getByRole("button", { name: `Account: ${user.username}`, exact: true })
      await account.click()

      await expect(
        dialog().getByRole("heading", { name: user.username, exact: true }),
      ).toBeVisible()

      await expect(dialog().locator(".account-identity .text-body-2")).toHaveCount(0)

      await expect(dialog().locator(".v-list-item").filter({ hasText: "User ID" })).toContainText(
        String(user.uid),
      )

      await expect(dialog()).toContainText("Local")
      await expect(dialog()).not.toContainText("Local development")
      await expect(dialog().getByRole("button", { name: "Sign out" })).toHaveCount(0)
      await page.screenshot({ path: join(evidence, "local-account.png") })
      await account.click()
      await expect(dialog()).not.toBeVisible()
    },
  )

  await step("create and delete a backend role through persisted settings", async () => {
    await settings().getByRole("button", { name: "Backend Roles", exact: true }).click()
    await settings().getByRole("button", { name: "Create", exact: true }).click()
    await dialog().getByLabel("Title", { exact: true }).fill("Browser role")
    await dialog().getByRole("button", { name: "Add rule", exact: true }).click()

    await dialog()
      .getByRole("combobox", { name: "Permission group", exact: true })
      .press("ArrowDown")

    await page.getByRole("option", { name: "Backend", exact: true }).click()
    await dialog().getByRole("combobox", { name: "Permissions", exact: true }).press("ArrowDown")
    await page.getByRole("option", { name: /View backend/ }).click()
    await page.keyboard.press("Escape")
    await dialog().getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog()).toBeHidden()

    await expect(
      settings().getByRole("heading", { name: "Browser role", exact: true }),
    ).toBeVisible()

    await settings().getByRole("button", { name: "Backend Roles", exact: true }).click()

    await expect(
      settings().getByRole("heading", { name: "Backend Roles", exact: true }),
    ).toBeVisible()

    await page.reload()
    const row = settings().getByRole("row").filter({ hasText: "Browser role" })
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Delete role", exact: true }).click()
    await expect(dialog()).toContainText("Browser role")
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Delete role", exact: true }).click()
    await dialog().getByRole("button", { name: "Delete", exact: true }).click()
    await expect(dialog()).toBeHidden()
    await page.reload()
    await expect(row).toHaveCount(0)
  })

  let projectId = ""

  await step("create a project through the trunk Designer workflow", async () => {
    projectId = await createProject("browser-smoke", "Browser smoke")
  })

  await step("settings scopes select a project without shifting the sidebar", async () => {
    await page.goto(`${designer!.url}/settings/project-list`)
    const entry = settings().getByRole("button", { name: "Projects", exact: true })
    await expect(entry).toBeVisible()
    const bounds = await entry.boundingBox()
    await settings().getByRole("button", { name: "Project", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${projectId}/`))
    await expect(settings().locator(".project-selector")).toContainText("Browser smoke")
    expect(await settings().locator(".project-selector .v-field").boundingBox()).toEqual(bounds)

    await settings()
      .getByRole("group", { name: "Security", exact: true })
      .getByRole("button", { name: "Roles", exact: true })
      .click()

    await expect(settings().getByRole("heading", { name: "Roles", exact: true })).toBeVisible()

    await settings()
      .getByRole("group", { name: "Resources", exact: true })
      .getByRole("button", { name: "Instances", exact: true })
      .click()

    await expect(settings().getByRole("heading", { name: "Instances", exact: true })).toBeVisible()
    await settings().getByRole("button", { name: "Backend", exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/project-list$/)
    expect(await entry.boundingBox()).toEqual(bounds)
  })

  await step("settings scopes preserve an explicitly chosen project", async () => {
    const alternateId = await createFixtureProject(
      designer!.url,
      "alternate-project",
      "Alternate project",
    )

    await page.goto(`${designer!.url}/settings/projects/${projectId}/operations`)
    await settings().locator(".project-selector .v-field").click()
    await page.getByRole("option", { name: "Alternate project", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${alternateId}/operations$`))
    await settings().getByRole("button", { name: "Backend", exact: true }).click()
    await settings().getByRole("button", { name: "Project", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/projects/${alternateId}/operations$`))
    await expect(settings().locator(".project-selector")).toContainText("Alternate project")
  })

  await step("browser has no runtime or local HTTP errors", async () => {
    expect(faults).toEqual([])
  })
} catch (error) {
  console.error(error)

  console.error(
    "Pending requests",
    [...pending].map(request => new URL(request.url()).pathname),
  )

  console.error("Designer diagnostics", designer?.logs())
  process.exitCode = 1
} finally {
  try {
    await browser?.close()

    if (designer && process.env.HIGHSTATE_E2E_KEEP_ALIVE === "1") {
      await writeFile(
        join(evidence, "browser-smoke.json"),
        JSON.stringify({ steps, faults }, null, 2),
      )

      console.log(`Evidence: ${evidence}`)
      await inspectDesigner(designer)
    }

    await designer?.stop()
    steps.push({ name: "cleanup disposable production process and state", status: "passed" })
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }

  await writeFile(join(evidence, "browser-smoke.json"), JSON.stringify({ steps, faults }, null, 2))
  console.log(`Evidence: ${evidence}`)
}
