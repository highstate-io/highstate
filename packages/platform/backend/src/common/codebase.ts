import type { Logger } from "pino"
import { mkdir } from "node:fs/promises"
import { dirname, relative } from "node:path"
import { resolvePackageJSON } from "pkg-types"
import z from "zod"

export const codebaseConfig = z.object({
  HIGHSTATE_CODEBASE_PATH: z.string().optional(),
})

let codebasePath: Promise<string> | undefined
let codebaseHighstatePath: Promise<string> | undefined

async function _getCodebasePath(
  config: z.infer<typeof codebaseConfig>,
  logger: Logger,
): Promise<string> {
  if (config.HIGHSTATE_CODEBASE_PATH) {
    return config.HIGHSTATE_CODEBASE_PATH
  }

  const packageJson = await resolvePackageJSON()
  const path = dirname(packageJson)

  if (path !== process.cwd()) {
    const relativePath = relative(process.cwd(), path)
    logger.info(`detected "%s" as codebase path`, relativePath)
  }

  return path
}

export async function getCodebasePath(
  config: z.infer<typeof codebaseConfig>,
  logger: Logger,
): Promise<string> {
  if (!codebasePath) {
    codebasePath = _getCodebasePath(config, logger)
  }

  return codebasePath
}

async function _getCodebaseHighstatePath(
  config: z.infer<typeof codebaseConfig>,
  logger: Logger,
): Promise<string> {
  const path = await getCodebasePath(config, logger)

  const highstatePath = `${path}/.highstate`
  await mkdir(highstatePath, { recursive: true })

  return highstatePath
}

export async function getCodebaseHighstatePath(
  config: z.infer<typeof codebaseConfig>,
  logger: Logger,
): Promise<string> {
  if (!codebaseHighstatePath) {
    codebaseHighstatePath = _getCodebaseHighstatePath(config, logger)
  }

  return codebaseHighstatePath
}
