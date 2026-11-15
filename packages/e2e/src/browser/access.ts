import type { BackendRoleRules, HumanRoleBindingOption } from "@highstate/backend/shared"
import type { Browser } from "@playwright/test"
import { join } from "node:path"
import { createId } from "@paralleldrive/cuid2"
import { expect as baseExpect } from "@playwright/test"
import { generateIdentity, identityToRecipient } from "age-encryption"
import { root } from "../harness/designer"
import { Evidence } from "../harness/evidence"
import { startHostedDesigner } from "../harness/hosted"
import { inspectDesigner } from "../harness/inspection"
import { withTimeout } from "../harness/wait"
import { DesignerBrowser } from "./client"
import { launchBrowser } from "./launch"

const evidence = new Evidence(
  join(root, ".artifacts/e2e", `access-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`),
)

const steps: { name: string; status: string }[] = []
const faults: string[] = []
const clients: DesignerBrowser[] = []
const expect = baseExpect.configure({ timeout: 30_000 })
let browser: Browser | undefined
let designer: Awaited<ReturnType<typeof startHostedDesigner>> | undefined
let admin: DesignerBrowser | undefined
const projectIds: string[] = []

async function step(name: string, action: () => Promise<void>) {
  try {
    await withTimeout(name, action(), 120_000)
    steps.push({ name, status: "passed" })
    console.log(`PASS ${name}`)
  } catch (error) {
    steps.push({ name, status: "failed" })
    throw error
  }
}

async function capture(client: DesignerBrowser, name: string) {
  await evidence.write("access.json", { steps, faults })
  await client.page.screenshot({ path: join(evidence.directory, `${name}.png`), fullPage: true })
}

type Role = { id: string; meta: { title: string } }
const readPermissions = ["user.list", "user.get", "role.list", "role-binding.list"] as const

try {
  designer = await startHostedDesigner()

  for (const value of designer.privateValues) {
    evidence.redact(value)
  }

  browser = await launchBrowser()

  const client = async () => {
    const context = await browser!.newContext({ viewport: { width: 1600, height: 1100 } })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)
    page.on("pageerror", error => faults.push(error.message))
    const result = new DesignerBrowser(page, designer!.url)
    clients.push(result)
    return result
  }

  admin = await client()
  const reader = await client()
  const outsider = await client()
  await admin.login("admin")
  await outsider.login("outsider")
  const userId = designer.userIds.reader

  await step(
    "account header reserves tab space and opens the OIDC profile with its loaded avatar",
    async () => {
      const accountButton = admin!.page.getByRole("button", { name: "Account: E2E Administrator" })
      await expect(accountButton).toBeVisible()
      await expect(admin!.page.getByRole("link", { name: "Account", exact: true })).toHaveCount(0)
      const avatar = accountButton.locator("img.v-img__img")
      await expect(avatar).toBeVisible()
      await expect(avatar).toHaveJSProperty("complete", true)

      expect(
        await avatar.evaluate(image => (image as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0)

      await expect(avatar).toHaveAttribute(
        "src",
        "https://avatars.githubusercontent.com/u/29506045?v=4",
      )

      const actions = accountButton.locator(
        "xpath=ancestor::div[contains(@class,'dv-right-actions-container')][last()]",
      )

      await expect(actions).toBeVisible()
      const tabs = actions.locator("xpath=../*[contains(@class,'dv-scrollable')]")
      const tabsBox = await tabs.boundingBox()
      const accountBox = await accountButton.boundingBox()
      expect(tabsBox).not.toBeNull()
      expect(accountBox).not.toBeNull()
      expect(tabsBox!.x + tabsBox!.width).toBeLessThanOrEqual(accountBox!.x)
      await accountButton.click()
      const dialog = admin!.page.getByRole("dialog")
      await expect(dialog).toContainText("Your account")
      await expect(dialog).toContainText("admin@example.test")
      await expect(dialog).toContainText("OpenID Connect")
      await expect(dialog.getByRole("button", { name: "Sign out" })).toBeVisible()
      await capture(admin!, "account-profile-avatar")
      await accountButton.click()
      await expect(dialog).not.toBeVisible()
    },
  )

  const bind = async (roleId: string, granted: boolean, projectId?: string) => {
    const input = { roleId, subject: { type: "user", id: userId }, granted }

    await admin!.call(
      projectId ? "projectRoleSettings.setHumanBinding" : "backendRoleSettings.setHumanBinding",
      projectId ? { ...input, projectId } : input,
      true,
    )
  }

  const backendRole = async (title: string, rules: BackendRoleRules) =>
    await admin!.call<Role>("backendRoleSettings.create", { meta: { title }, rules }, true)

  await step(
    "unprivileged directories explain denial and disable creation without duplicate notices",
    async () => {
      await outsider.page
        .locator(".dv-tab")
        .filter({ hasText: /^Projects$/ })
        .click()

      await outsider.deniedTooltip(
        outsider.page.locator(".main-menu-list .v-list-item").filter({ hasText: /^\s*Create\s*$/ }),
        "project.create",
      )

      await capture(outsider, "denied-project-creation")

      for (const [path, read, write] of [
        ["project-list", "project.list", undefined],
        ["backend-roles", "role.list", "role.create"],
        ["backend-service-accounts", "service-account.list", "service-account.manage"],
        ["backend-api-keys", "api-key.list", "api-key.create"],
        ["backend-users", "user.list", undefined],
      ] as const) {
        await outsider.page.goto(`${designer!.url}/settings/${path}`)

        await expect(
          outsider.page
            .locator(".content-area .access-notice")
            .filter({ hasText: `Required permission: ${read}` }),
        ).toBeVisible()

        await expect(outsider.page.locator(".access-rejection-banner")).toHaveCount(0)

        if (write) {
          await outsider.deniedTooltip(
            outsider.page.locator(".content-area button").filter({ hasText: /^\s*Create\s*$/ }),
            write,
          )
        }

        await capture(outsider, `denied-${path}`)
      }

      const response = await outsider.request("backendUserSettings.query", {})
      expect(response.status()).toBe(403)
    },
  )

  await step(
    "newly signed-in users appear in an already-open directory without refresh",
    async () => {
      await admin!.settings("/settings/backend-users", "Backend Users")
      await expect(admin!.page.getByRole("row").filter({ hasText: "E2E Reader" })).toHaveCount(0)
      await reader.login("reader")
      await expect(admin!.page.getByRole("row").filter({ hasText: "E2E Reader" })).toBeVisible()
      await capture(admin!, "known-users-live-sign-in")
    },
  )

  const projectId = createId()
  const identity = await generateIdentity()

  await admin.call(
    "project.createProject",
    {
      projectId,
      projectInput: { name: "access-review", meta: { title: "Access review project" } },
      unlockMethodInput: {
        type: "password",
        meta: { title: "Disposable test identity" },
        recipient: await identityToRecipient(identity),
        encryptedIdentity: "isolated-unencrypted-fixture",
      },
    },
    true,
  )

  await admin.call("state.unlockProject", { projectId, decryptedIdentity: identity }, true)
  projectIds.push(projectId)

  const opener = await backendRole("Project navigation", [
    { permissions: ["project.get", "project.list", "project.open"] },
  ])

  await bind(opener.id, true)

  await admin.call(
    "backendRoleSettings.setHumanBinding",
    { roleId: opener.id, subject: { type: "user", id: designer.userIds.outsider }, granted: true },
    true,
  )

  await step(
    "every restricted project settings collection explains denial instead of showing an empty table",
    async () => {
      for (const [path, permission] of [
        ["instances", "instance-state.list"],
        ["secrets", "secret.list"],
        ["terminals", "terminal.list"],
        ["pages", "page.list"],
        ["panels", "panel.list"],
        ["operations", "operation.list"],
        ["triggers", "trigger.list"],
        ["artifacts", "artifact.list"],
        ["workers", "worker.list"],
        ["entities", "entity.list"],
        ["unlock-methods", "unlock-method.list"],
        ["service-accounts", "service-account.list"],
        ["roles", "role.list"],
        ["api-keys", "api-key.list"],
        ["users", "user.list"],
      ] as const) {
        await outsider.page.goto(`${designer!.url}/settings/projects/${projectId}/${path}`)

        await expect(
          outsider.page
            .locator(".content-area .access-notice")
            .filter({ hasText: `Required permission: ${permission}` }),
        ).toBeVisible()

        await expect(
          outsider.page.locator(".content-area").getByText("No data available", { exact: true }),
        ).toHaveCount(0)

        await expect(outsider.page.locator(".access-rejection-banner")).toHaveCount(0)
        await capture(outsider, `denied-project-${path}`)
      }
    },
  )

  await step(
    "backend and project directories include all known users before their first project binding",
    async () => {
      for (const [prefix, title] of [
        ["/settings/backend-users", "Backend Users"],
        [`/settings/projects/${projectId}/users`, "Users"],
      ]) {
        await admin!.settings(prefix!, title!)

        for (const name of ["E2E Administrator", "E2E Reader", "E2E Outsider"]) {
          await expect(admin!.page.getByRole("row").filter({ hasText: name })).toBeVisible()
        }

        await admin!.page.getByPlaceholder("Search").fill("outsider@example.test")
        await expect(admin!.page.getByRole("row").filter({ hasText: "E2E Outsider" })).toBeVisible()
        await expect(admin!.page.getByRole("row").filter({ hasText: "E2E Reader" })).toHaveCount(0)
        await admin!.page.getByPlaceholder("Search").fill("")
        await capture(admin!, title === "Users" ? "project-known-users" : "backend-known-users")
      }

      const bindings = await admin!.call<HumanRoleBindingOption[]>(
        "projectUserSettings.roleBindings",
        { projectId, userId },
      )

      expect(bindings.every(role => !role.granted)).toBe(true)
    },
  )

  const realmRoles: { projectId?: string; roles: Role[]; prefix: string }[] = []

  for (const realm of ["backend", "project"] as const) {
    const project = realm === "project" ? projectId : undefined
    const prefix = project ? `/settings/projects/${project}/users` : "/settings/backend-users"
    const roles: Role[] = []

    for (const letter of ["A", "B"]) {
      const role = {
        meta: { title: `${realm} reader ${letter}` },
        rules: [{ permissions: [...readPermissions] }],
      }

      roles.push(
        project
          ? await admin.call<Role>("projectRoleSettings.create", { projectId: project, role }, true)
          : await backendRole(role.meta.title, role.rules),
      )
    }

    realmRoles.push({ projectId: project, roles, prefix })

    await step(
      `${realm} users and service accounts assign multiple checkbox-selected roles`,
      async () => {
        await admin!.settings(`${prefix}/${userId}`, "E2E Reader")
        let panel = await admin!.selectRoles(roles.map(role => role.meta.title))
        await capture(admin!, `${realm}-user-multiple-selected`)
        const userPattern = `**/api/${project ? "project" : "backend"}RoleSettings.setHumanBinding*`

        await admin!.page.route(userPattern, async route => {
          if (route.request().postData()?.includes(roles[1]!.id)) {
            await route.abort("failed")
          } else {
            await route.continue()
          }
        })

        await panel.getByRole("button", { name: "Add", exact: true }).click()
        await expect(panel.getByRole("row").filter({ hasText: roles[0]!.meta.title })).toBeVisible()

        await expect(panel.locator(".access-notice")).toContainText(
          "The role binding could not be changed",
        )

        await expect(panel.locator(".v-select .v-chip")).toContainText(roles[1]!.meta.title)
        await capture(admin!, `${realm}-user-partial-failure`)
        await admin!.page.unroute(userPattern)
        await panel.getByRole("button", { name: "Add", exact: true }).click()

        for (const role of roles) {
          await expect(panel.getByRole("row").filter({ hasText: role.meta.title })).toBeVisible()
        }

        await expect(panel.locator(".v-expansion-panel-title .v-chip")).toHaveText(
          project ? "2" : "3",
        )

        const granted = await admin!.call<HumanRoleBindingOption[]>(
          project ? "projectUserSettings.roleBindings" : "backendUserSettings.roleBindings",
          project ? { projectId: project, userId } : { userId },
        )

        for (const role of roles) {
          expect(granted.find(binding => binding.id === role.id)?.granted).toBe(true)
        }

        await capture(admin!, `${realm}-user-multiple-assigned`)

        const input = { meta: { title: `${realm} automation` } }

        const account = await admin!.call<{ id: string }>(
          project ? "projectServiceAccountSettings.create" : "backendServiceAccountSettings.create",
          project ? { projectId: project, serviceAccount: input } : input,
          true,
        )

        await admin!.settings(
          project
            ? `/settings/projects/${project}/service-accounts/${account.id}`
            : `/settings/backend-service-accounts/${account.id}`,
          input.meta.title,
        )

        panel = await admin!.selectRoles(roles.map(role => role.meta.title))
        await panel.getByRole("button", { name: "Add", exact: true }).click()

        for (const role of roles) {
          await expect(panel.getByRole("row").filter({ hasText: role.meta.title })).toBeVisible()
        }

        const bindings = await admin!.call<{ roleId: string }[]>(
          project
            ? "projectServiceAccountSettings.getRoleBindings"
            : "backendServiceAccountSettings.getRoleBindings",
          project
            ? { projectId: project, serviceAccountId: account.id }
            : { serviceAccountId: account.id },
        )

        expect(bindings.map(binding => binding.roleId).sort()).toEqual(
          roles.map(role => role.id).sort(),
        )

        await capture(admin!, `${realm}-service-account-multiple-assigned`)

        // A failed second write must not hide the successful binding or discard the remaining selection.
        for (const role of roles) {
          await panel
            .getByRole("row")
            .filter({ hasText: role.meta.title })
            .getByRole("button")
            .click()

          await expect(panel.getByRole("row").filter({ hasText: role.meta.title })).toHaveCount(0)
        }

        panel = await admin!.selectRoles(roles.map(role => role.meta.title))
        const pattern = `**/api/${project ? "project" : "backend"}ServiceAccountSettings.addRoleBinding*`

        await admin!.page.route(pattern, async route => {
          if (route.request().postData()?.includes(roles[1]!.id)) {
            await route.abort("failed")
          } else {
            await route.continue()
          }
        })

        await panel.getByRole("button", { name: "Add", exact: true }).click()
        await expect(panel.getByRole("row").filter({ hasText: roles[0]!.meta.title })).toBeVisible()
        await expect(panel.locator(".v-alert")).toBeVisible()
        await expect(panel.locator(".v-select .v-chip")).toContainText(roles[1]!.meta.title)
        await capture(admin!, `${realm}-partial-failure`)
        await admin!.page.unroute(pattern)
        await panel.getByRole("button", { name: "Add", exact: true }).click()
        await expect(panel.getByRole("row").filter({ hasText: roles[1]!.meta.title })).toBeVisible()

        const retriedBindings = await admin!.call<{ roleId: string }[]>(
          project
            ? "projectServiceAccountSettings.getRoleBindings"
            : "backendServiceAccountSettings.getRoleBindings",
          project
            ? { projectId: project, serviceAccountId: account.id }
            : { serviceAccountId: account.id },
        )

        expect(retriedBindings.map(binding => binding.roleId).sort()).toEqual(
          roles.map(role => role.id).sort(),
        )
      },
    )

    await step(
      `${realm} role editing is disabled with hover explanations and protected by the real API`,
      async () => {
        await reader.settings(`${prefix}/${userId}`, "E2E Reader")
        const panel = await reader.roles()

        await reader.deniedTooltip(
          panel.locator(`button[aria-label="Remove ${roles[0]!.meta.title}"]`),
          "role.update",
        )

        await capture(reader, `${realm}-remove-denied`)

        const response = await reader.request(
          project ? "projectRoleSettings.setHumanBinding" : "backendRoleSettings.setHumanBinding",
          {
            ...(project ? { projectId: project } : {}),
            roleId: roles[0]!.id,
            subject: { type: "user", id: userId },
            granted: false,
          },
          true,
        )

        expect(response.status()).toBe(403)
        expect(await response.text()).toContain("role.update")
        await panel.locator(".v-select .v-field").click()

        const adminOption = reader.page
          .locator(".v-overlay--active .v-list-item")
          .filter({ hasText: /^\s*Admin\s*$/ })

        await reader.deniedTooltip(adminOption, "role.update")
        await capture(reader, `${realm}-selector-denied`)
        await reader.page.keyboard.press("Escape")
        await expect(reader.page.getByRole("button", { name: /refresh|reload/i })).toHaveCount(0)
      },
    )
  }

  await step("backend and project bindings remain independent", async () => {
    const backend = await admin!.call<HumanRoleBindingOption[]>(
      "backendUserSettings.roleBindings",
      { userId },
    )

    const project = await admin!.call<HumanRoleBindingOption[]>(
      "projectUserSettings.roleBindings",
      { projectId, userId },
    )

    for (const role of realmRoles[0]!.roles) {
      expect(project.some(binding => binding.id === role.id)).toBe(false)
    }

    for (const role of realmRoles[1]!.roles) {
      expect(backend.some(binding => binding.id === role.id)).toBe(false)
    }
  })

  await step(
    "restricted canvas, components, and operations replace the whole panel with centered denial",
    async () => {
      await reader.page.goto(`${designer!.url}/projects/${projectId}`)

      await expect(
        reader.page
          .locator(".access-notice-panel")
          .filter({ hasText: "instance-model.get" })
          .first(),
      ).toBeVisible()

      await capture(reader, "canvas-denied")

      await reader.page
        .locator(".dv-tab")
        .filter({ hasText: /^Components$/ })
        .click()

      await expect(
        reader.page.locator(".access-notice-panel").filter({ hasText: "library.get" }).first(),
      ).toBeVisible()

      await capture(reader, "components-denied")

      await reader.page
        .locator(".dv-tab")
        .filter({ hasText: /^Operations$/ })
        .click()

      await expect(
        reader.page.locator(".access-notice-panel").filter({ hasText: "operation.list" }).first(),
      ).toBeVisible()

      await capture(reader, "operations-denied")
    },
  )

  await step(
    "scoped role editing and escalation permissions update an already-open selector live",
    async () => {
      const realm = realmRoles[0]!
      await reader.settings(`${realm.prefix}/${userId}`, "E2E Reader")
      let panel = await reader.roles()

      const scoped = await backendRole("Scoped role editor", [
        {
          permissions: ["role.update"],
          restrictions: [{ type: "resources", resourceIds: [realm.roles[0]!.id] }],
        },
      ])

      await bind(scoped.id, true)

      await expect(
        panel.locator(`button[aria-label="Remove ${realm.roles[0]!.meta.title}"]`),
      ).not.toHaveAttribute("aria-disabled", "true")

      await expect(
        panel.locator(`button[aria-label="Remove ${realm.roles[1]!.meta.title}"]`),
      ).toHaveAttribute("aria-disabled", "true")

      const scopedDenial = await reader.request(
        "backendRoleSettings.setHumanBinding",
        { roleId: realm.roles[1]!.id, subject: { type: "user", id: userId }, granted: false },
        true,
      )

      expect(scopedDenial.status()).toBe(403)
      expect(await scopedDenial.text()).toContain("role.update")

      await capture(reader, "scoped-role-editing")

      await reader.page
        .getByRole("button", { name: `Remove ${realm.roles[0]!.meta.title}`, exact: true })
        .click()

      await expect(
        panel.getByRole("row").filter({ hasText: realm.roles[0]!.meta.title }),
      ).toHaveCount(0)

      await bind(realm.roles[0]!.id, true)

      const editor = await backendRole("Role editor without escalation", [
        { permissions: ["role.update"] },
      ])

      await bind(editor.id, true)

      await expect(
        panel.locator(`button[aria-label="Remove ${realm.roles[1]!.meta.title}"]`),
      ).not.toHaveAttribute("aria-disabled", "true")

      await panel.locator(".v-select .v-field").click()

      const option = reader.page
        .locator(".v-overlay--active .v-list-item")
        .filter({ hasText: /^\s*Admin\s*$/ })

      await reader.deniedTooltip(option, "role.escalate")
      await capture(reader, "escalation-denied")

      const adminRole = (
        await admin!.call<HumanRoleBindingOption[]>("backendUserSettings.roleBindings", { userId })
      ).find(role => role.meta.title === "Admin")!

      const response = await reader.request(
        "backendRoleSettings.setHumanBinding",
        { roleId: adminRole.id, subject: { type: "user", id: userId }, granted: true },
        true,
      )

      expect(response.status()).toBe(403)
      expect(await response.text()).toContain("role.escalate")
      await reader.page.keyboard.press("Escape")
      await bind(editor.id, false)
      await bind(scoped.id, false)
      panel = await reader.roles()

      await expect(
        panel.locator(`button[aria-label="Remove ${realm.roles[0]!.meta.title}"]`),
      ).toHaveAttribute("aria-disabled", "true")
    },
  )

  await step(
    "revocation, restoration, and reconnect clear and restore protected user data without refresh",
    async () => {
      for (const realm of realmRoles) {
        await reader.settings(`${realm.prefix}/${userId}`, "E2E Reader")

        for (const role of realm.roles) {
          await bind(role.id, false, realm.projectId)
        }

        await expect(
          reader.page.locator(".content-area .access-notice").filter({ hasText: "user.get" }),
        ).toBeVisible()

        await expect(
          reader.page
            .locator(".content-area")
            .getByRole("heading", { name: "E2E Reader", exact: true }),
        ).toHaveCount(0)

        await expect(reader.page.locator(".access-rejection-banner")).toHaveCount(0)

        await capture(
          reader,
          realm.projectId ? "project-live-revocation" : "backend-live-revocation",
        )

        await bind(realm.roles[0]!.id, true, realm.projectId)

        await expect(
          reader.page.getByRole("heading", { name: "E2E Reader", exact: true }),
        ).toBeVisible()

        await reader.page.context().setOffline(true)
        await bind(realm.roles[0]!.id, false, realm.projectId)
        await reader.page.context().setOffline(false)

        await expect(
          reader.page.locator(".content-area .access-notice").filter({ hasText: "user.get" }),
        ).toBeVisible({ timeout: 30_000 })

        await bind(realm.roles[0]!.id, true, realm.projectId)

        await expect(
          reader.page.getByRole("heading", { name: "E2E Reader", exact: true }),
        ).toBeVisible()
      }
    },
  )

  await step(
    "revoking a hosted session stops protected interaction and offers sign-in",
    async () => {
      const account = await reader.page.context().newPage()
      await account.goto(`${designer!.url}/login`)
      await account.getByRole("button", { name: "Sign out", exact: true }).click()

      await expect(
        reader.page.getByRole("link", { name: "Sign in again", exact: true }),
      ).toBeVisible({ timeout: 30_000 })

      await expect(reader.page.locator(".dockview-container")).toHaveCount(0)
      await expect(reader.page.locator(".access-rejection-banner")).toHaveCount(0)
      await expect(reader.page.locator(".session-expired-panel .access-notice-panel")).toBeVisible()
      await expect(
        reader.page.getByRole("link", { name: "Sign in again", exact: true }),
      ).toHaveClass(/v-btn/)
      await capture(reader, "session-revoked")
    },
  )

  expect(faults).toEqual([])
  expect(designer.logs()).not.toMatch(/library watcher failed|unhandledRejection/)
} catch (error) {
  console.error(evidence.sanitize(String(error)))
  console.error("Designer diagnostics", evidence.sanitize(designer?.logs() ?? ""))
  steps.push({ name: String(error), status: "failed" })
  process.exitCode = 1

  for (const [index, client] of clients.entries()) {
    await capture(client, `failure-${index}`).catch(() => {})

    await evidence
      .write(`failure-${index}.json`, {
        path: new URL(client.page.url()).pathname,
        body: await client.page.locator("body").innerText(),
      })
      .catch(() => {})
  }
} finally {
  await evidence.write("access.json", { steps, faults })
  await browser?.close()

  if (designer && process.env.HIGHSTATE_E2E_KEEP_ALIVE === "1") {
    await inspectDesigner(designer, projectIds)
  }

  await designer?.stop()
  console.log(`Evidence: ${evidence.directory}`)
}
