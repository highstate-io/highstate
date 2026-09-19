import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { AsyncEntry } from "@napi-rs/keyring"
import { z } from "zod"

const serviceName = "io.highstate.cli"
const contextNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const contextSchema = z.object({
  apiUrl: z.string().url().or(z.string().startsWith("unix://")),
  projectId: z.string().min(1).optional(),
  apiToken: z.string().min(1).optional(),
})
const configSchema = z.object({
  activeContext: z.string().optional(),
  contexts: z.record(z.string(), contextSchema).default({}),
})

export type RemoteContext = z.infer<typeof contextSchema>
export type RemoteConfig = z.infer<typeof configSchema>

export function validateContextName(name: string): string {
  return contextNameSchema.parse(name)
}

export function normalizeApiUrl(value: string): string {
  const input = value.trim()

  if (input.startsWith("unix://")) {
    if (input === "unix://") {
      throw new Error("Highstate API URL must include a Unix socket path")
    }

    return input
  }

  const url = new URL(input.includes("://") ? input : `http://${input}`)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Unsupported Highstate API URL protocol "${url.protocol}"; use http, https, or unix`,
    )
  }

  if (!url.hostname) {
    throw new Error("Highstate API URL must include a hostname")
  }

  return url.toString().replace(/\/$/, "")
}

export function getRemoteConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.HIGHSTATE_CONFIG_PATH ??
    join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "highstate", "config.json")
  )
}

export async function readRemoteConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RemoteConfig> {
  const path = getRemoteConfigPath(env)

  try {
    return configSchema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { contexts: {} }
    }

    throw new Error(`Failed to read Highstate CLI configuration from "${path}"`, { cause: error })
  }
}

export async function writeRemoteConfig(
  config: RemoteConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = getRemoteConfigPath(env)
  const parsed = configSchema.parse(config)

  await mkdir(dirname(path), { recursive: true, mode: 0o700 })

  const temporaryPath = `${path}.${process.pid}.tmp`

  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, path)
}

function credentialEntry(name: string): AsyncEntry {
  return new AsyncEntry(serviceName, `context:${validateContextName(name)}`)
}

export class KeyringUnavailableError extends Error {
  readonly details?: string

  constructor(error: unknown) {
    const details =
      typeof error === "object" && error !== null
        ? [
            "code" in error ? String(error.code) : undefined,
            "message" in error ? String(error.message) : undefined,
          ]
            .filter((value, index, values) => value && values.indexOf(value) === index)
            .join(": ") || undefined
        : undefined

    super(
      "System keyring is unavailable; ensure a keyring or secret service is available, or use --insecure to store the API token in plaintext",
      { cause: error },
    )

    this.details = details
  }
}

export async function assertKeyringAvailable(): Promise<void> {
  const id = crypto.randomUUID()
  const entry = new AsyncEntry(serviceName, `__highstate_keyring_probe__:${id}`)
  const token = `probe-${id}`
  let credentialCreated = false

  try {
    await entry.setPassword(token)
    credentialCreated = true

    if ((await entry.getPassword()) !== token) {
      throw new Error("Keyring probe returned a different value")
    }
  } catch (error) {
    if (credentialCreated) {
      try {
        await entry.deleteCredential()
      } catch {
        // Preserve the failure that made the keyring unavailable.
      }
    }

    throw new KeyringUnavailableError(error)
  }

  try {
    await entry.deleteCredential()
  } catch (error) {
    throw new KeyringUnavailableError(error)
  }
}

async function accessContextToken<T>(
  name: string,
  operation: string,
  callback: (entry: AsyncEntry) => Promise<T>,
): Promise<T> {
  try {
    return await callback(credentialEntry(name))
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? ` (${String(error.code)})`
        : ""

    throw new Error(
      `Failed to ${operation} the API token for Highstate context "${name}" in the system keyring${code}; ensure a keyring or secret service is available`,
      { cause: error },
    )
  }
}

export async function setContextToken(name: string, token: string): Promise<void> {
  if (!token.trim()) {
    throw new Error("API token cannot be empty")
  }

  await accessContextToken(name, "store", entry => entry.setPassword(token.trim()))
}

export async function getContextToken(
  name: string,
  context?: RemoteContext,
): Promise<string | undefined> {
  if (context?.apiToken) {
    return context.apiToken
  }

  return await accessContextToken(name, "read", entry => entry.getPassword())
}

export async function deleteContextToken(name: string): Promise<void> {
  await accessContextToken(name, "delete", entry => entry.deleteCredential())
}

export type RemoteOverrides = {
  context?: string
  apiUrl?: string
  projectId?: string
}

export type RemoteTarget = {
  contextName?: string
  apiUrl: string
  apiToken: string
  projectId?: string
}

export async function resolveRemoteTarget(
  overrides: RemoteOverrides,
  options: { requireProject?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<RemoteTarget> {
  const env = options.env ?? process.env
  const config = await readRemoteConfig(env)
  const contextName = overrides.context ?? env.HIGHSTATE_CONTEXT ?? config.activeContext
  const context = contextName ? config.contexts[contextName] : undefined

  if (contextName && !context) {
    throw new Error(`Highstate context "${contextName}" not found`)
  }

  const apiUrl = overrides.apiUrl ?? env.HIGHSTATE_API_URL ?? context?.apiUrl

  if (!apiUrl) {
    throw new Error("No active Highstate backend; use a context or provide --api-url")
  }

  const apiToken =
    env.HIGHSTATE_API_TOKEN ??
    (contextName ? await getContextToken(contextName, context) : undefined)

  if (!apiToken) {
    throw new Error("No API token available for the active Highstate backend")
  }

  const projectId = overrides.projectId ?? env.HIGHSTATE_PROJECT_ID ?? context?.projectId

  if (options.requireProject && !projectId) {
    throw new Error("No active Highstate project; run highstate project use or provide --project")
  }

  return { contextName, apiUrl, apiToken, projectId }
}
