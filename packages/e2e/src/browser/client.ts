import type { Locator, Page } from "@playwright/test"
import type { OidcUser } from "../harness/oidc"
import { expect as baseExpect } from "@playwright/test"
import { oidcUsers } from "../harness/oidc"

const expect = baseExpect.configure({ timeout: 30_000 })

/**
 * Browser-side interactions against the real hosted Designer and its session cookies.
 */
export class DesignerBrowser {
  constructor(
    readonly page: Page,
    readonly url: string,
  ) {}

  async login(identity: OidcUser) {
    await this.page.goto(`${this.url}/login`)
    await this.page.getByRole("link", { name: "Continue with E2E OIDC" }).click()
    await this.page.getByRole("button", { name: oidcUsers[identity].name, exact: true }).click()
    await expect(this.page.locator(".dv-tab").first()).toBeVisible({ timeout: 60_000 })
  }

  async request(procedure: string, input: unknown, mutation = false) {
    const encoded = JSON.stringify({ json: input })
    return await this.page.request.fetch(
      `${this.url}/api/${procedure}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", origin: this.url },
        data: mutation ? encoded : undefined,
      },
    )
  }

  async call<T>(procedure: string, input: unknown, mutation = false): Promise<T> {
    const response = await this.request(procedure, input, mutation)
    const body = await response.json()

    expect(response.ok(), `Designer procedure ${procedure}: ${JSON.stringify(body.error)}`).toBe(
      true,
    )

    return body.result.data.json as T
  }

  async settings(path: string, title: string) {
    await this.page.goto(`${this.url}${path}`)

    await expect(
      this.page.locator(".data-settings-panel").getByRole("heading", { name: title, exact: true }),
    ).toBeVisible()
  }

  async roles() {
    const panel = this.page
      .locator(".v-expansion-panel")
      .filter({ has: this.page.locator(".v-expansion-panel-title", { hasText: "Roles" }) })

    const title = panel.locator(".v-expansion-panel-title")
    await expect(title).toBeVisible()

    if ((await title.getAttribute("aria-expanded")) !== "true") {
      await title.click()
    }

    await expect(panel.getByRole("combobox", { name: "Roles", exact: true })).toBeVisible()

    await panel.locator(".v-expansion-panel-text").evaluate(async element => {
      await Promise.all(
        element.getAnimations().map(animation => animation.finished.catch(() => {})),
      )
    })

    return panel
  }

  async selectRoles(names: string[]) {
    const panel = await this.roles()
    await expect(panel.getByRole("combobox", { name: "Roles", exact: true })).toBeEnabled()
    await panel.locator(".v-select .v-field").click()

    for (const name of names) {
      const option = this.page.getByRole("option", { name, exact: true })
      await option.click()
      await expect(option.locator(".v-checkbox-btn")).toBeVisible()
      await expect(option.locator('input[type="checkbox"]')).toBeChecked()
    }

    await this.page.keyboard.press("Escape")
    await expect(this.page.locator(".v-overlay--active .v-list")).toBeHidden()
    return panel
  }

  async deniedTooltip(control: Locator, permission: string) {
    await expect(control).toHaveAttribute("aria-disabled", "true")
    await control.scrollIntoViewIfNeeded()
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    await this.page.mouse.move(bounds!.x - 4, bounds!.y - 4)
    await this.page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)

    const tooltip = this.page
      .locator(".access-tooltip")
      .filter({ hasText: `Required permission: ${permission}` })

    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveCSS("white-space", "pre-line")
    expect(await tooltip.textContent()).toMatch(/\nRequired permission:/)
    return tooltip
  }
}
