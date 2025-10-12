import type { Logger } from "pino"
import console from "node:console"
import { Crc32, crc32 } from "@aws-crypto/crc32"
import {
  type Component,
  type ComponentModel,
  type Entity,
  type EntityModel,
  isComponent,
  isEntity,
  isUnitModel,
} from "@highstate/contract"
import { encode } from "@msgpack/msgpack"
import { int32ToBytes } from "./utils"

export type Library = Readonly<{
  components: Readonly<Record<string, ComponentModel>>
  entities: Readonly<Record<string, EntityModel>>
}>

export async function loadLibrary(logger: Logger, modulePaths: string[]): Promise<Library> {
  const modules: Record<string, unknown> = {}
  for (const modulePath of modulePaths) {
    try {
      logger.debug({ modulePath }, "loading module")
      modules[modulePath] = await import(modulePath)

      logger.debug({ modulePath }, "module loaded")
    } catch (error) {
      console.error(error)

      throw new Error(`Failed to load module "${modulePath}"`, { cause: error })
    }
  }

  const components: Record<string, ComponentModel> = {}
  const entities: Record<string, EntityModel> = {}

  await _loadLibrary(modules, components, entities)

  logger.info(
    {
      componentCount: Object.keys(components).length,
      entityCount: Object.keys(entities).length,
    },
    "library loaded",
  )

  logger.trace({ components, entities }, "library content")

  return { components, entities }
}

async function _loadLibrary(
  value: unknown,
  components: Record<string, ComponentModel>,
  entities: Record<string, EntityModel>,
): Promise<void> {
  if (isComponent(value)) {
    const entityHashes: number[] = []
    for (const entity of value.entities.values()) {
      entity.model.definitionHash ??= calculateEntityDefinitionHash(entity)
      entityHashes.push(entity.model.definitionHash)
    }

    components[value.model.type] = value.model
    value.model.definitionHash = await calculateComponentDefinitionHash(value, entityHashes)

    return
  }

  if (isEntity(value)) {
    entities[value.type] = value.model
    entities[value.type].definitionHash ??= calculateEntityDefinitionHash(value)

    // @ts-expect-error remove the schema since it's not needed in the designer
    delete value.model.schema
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
      await _loadLibrary(item, components, entities)
    }

    return
  }

  for (const key in value) {
    await _loadLibrary((value as Record<string, unknown>)[key], components, entities)
  }
}

async function calculateComponentDefinitionHash(
  component: Component,
  entityHashes: number[],
): Promise<number> {
  const result = new Crc32()

  // 1. include the full component model
  result.update(encode(component.model))

  if (!isUnitModel(component.model)) {
    // 2. for composite components, include the content of the serialized create function
    // const serializedCreate = await serializeFunction(component[originalCreate])
    const serializedCreate = { text: "TODO: investigate why serializeFunction hangs" }
    result.update(Buffer.from(serializedCreate.text))
  }

  // 3. include the hashes of all entities
  for (const entityHash of entityHashes) {
    result.update(int32ToBytes(entityHash))
  }

  return result.digest()
}

function calculateEntityDefinitionHash(entity: Entity): number {
  return crc32(encode(entity.model))
}
