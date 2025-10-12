import type { Logger } from "pino"
import { type Component, isComponent } from "@highstate/contract"

export async function loadComponents(
  logger: Logger,
  modulePaths: string[],
): Promise<Readonly<Record<string, Component>>> {
  const modules: Record<string, unknown> = {}
  for (const modulePath of modulePaths) {
    try {
      logger.debug({ modulePath }, "loading module")
      modules[modulePath] = await import(modulePath)

      logger.debug({ modulePath }, "module loaded")
    } catch (err) {
      logger.error({ modulePath, err }, "module load failed")
    }
  }

  const components: Record<string, Component> = {}

  await _loadLibrary(modules, components)
  logger.debug("library loaded with %s components", Object.keys(components).length)

  return components
}

async function _loadLibrary(value: unknown, components: Record<string, Component>): Promise<void> {
  if (isComponent(value)) {
    components[value.model.type] = value
    return
  }

  if (typeof value !== "object" || value === null) {
    return
  }

  if ("_zod" in value) {
    // this is a zod schema, we can skip it
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      await _loadLibrary(item, components)
    }

    return
  }

  for (const key in value) {
    await _loadLibrary((value as Record<string, unknown>)[key], components)
  }
}
