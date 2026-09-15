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

export async function setContextToken(name: string, token: string): Promise<void> {
  if (!token.trim()) {
    throw new Error("API token cannot be empty")
  }

  await credentialEntry(name).setPassword(token.trim())
}

export async function getContextToken(name: string): Promise<string | undefined> {
  return await credentialEntry(name).getPassword()
}

export async function deleteContextToken(name: string): Promise<void> {
  await credentialEntry(name).deleteCredential()
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
    env.HIGHSTATE_API_TOKEN ?? (contextName ? await getContextToken(contextName) : undefined)

  if (!apiToken) {
    throw new Error("No API token available for the active Highstate backend")
  }

  const projectId = overrides.projectId ?? env.HIGHSTATE_PROJECT_ID ?? context?.projectId

  if (options.requireProject && !projectId) {
    throw new Error("No active Highstate project; run highstate project use or provide --project")
  }

  return { contextName, apiUrl, apiToken, projectId }
}
