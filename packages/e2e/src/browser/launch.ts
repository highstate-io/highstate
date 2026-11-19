import { chromium } from "@playwright/test"

/**
 * Uses the installed browser, or the development toolchain's explicitly supplied Chromium.
 */
export async function launchBrowser() {
  return await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    executablePath: process.env.CHROMIUM_PATH,
  })
}
