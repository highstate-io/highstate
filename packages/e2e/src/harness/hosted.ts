import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getOidcUserId } from "@highstate/backend"
import { generateIdentity } from "age-encryption"
import { Cleanup } from "./cleanup"
import { startDesigner } from "./designer"
import { oidcUsers, startOidc } from "./oidc"
import { startPostgres } from "./postgres"

/**
 * Starts the shared Designer harness with a disposable local OIDC provider.
 */
export async function startHostedDesigner() {
  const oidc = startOidc()
  const cleanup = new Cleanup()
  cleanup.add(() => oidc.stop())

  const userIds = Object.fromEntries(
    Object.entries(oidcUsers).map(([key, user]) => [key, getOidcUserId(oidc.issuer, user.subject)]),
  ) as Record<keyof typeof oidcUsers, string>

  try {
    const postgres = await startPostgres()
    cleanup.add(() => postgres.stop())

    const designer = await startDesigner({
      mode: "development",
      env: async ({ url, directory }) => {
        oidc.setDesignerUrl(url)
        const identityPath = join(directory, ".highstate", "backend-identity.key")
        await writeFile(identityPath, await generateIdentity(), { mode: 0o600 })
        return {
          HIGHSTATE_PUBLIC_URL: url,
          HIGHSTATE_AUTH_MODE: "hosted",
          HIGHSTATE_ENCRYPTION_ENABLED: "true",
          HIGHSTATE_BACKEND_DATABASE_TYPE: "postgresql",
          HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL: postgres.url,
          HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: identityPath,
          HIGHSTATE_AUTH_DEVELOPMENT_HTTP: "true",
          HIGHSTATE_AUTH_ADMIN_USER_IDS: JSON.stringify([userIds.admin]),
          HIGHSTATE_AUTH_PROVIDERS: JSON.stringify([
            {
              id: "e2e-oidc",
              title: "E2E OIDC",
              clientId: oidc.clientId,
              clientSecret: oidc.clientSecret,
              clientAuthMethod: "client_secret_basic",
              scopes: ["profile", "email"],
              identity: { protocol: "oidc", issuer: oidc.issuer },
            },
          ]),
        }
      },
    })

    cleanup.add(() => designer.stop())
    let stopped = false

    return {
      ...designer,
      userIds,
      privateValues: [oidc.clientSecret, postgres.url],
      async stop() {
        if (stopped) {
          return
        }

        stopped = true
        await cleanup.run()
      },
    }
  } catch (error) {
    try {
      await cleanup.run()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Hosted Designer fixture failed", {
        cause: cleanupError,
      })
    }

    throw error
  }
}
