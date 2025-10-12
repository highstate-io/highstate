import type { ComponentModel, EntityModel, Component } from "@highstate/contract"
import { isComponent } from "@highstate/contract"

interface LibraryData {
  components: Record<string, ComponentModel>
  entities: Record<string, EntityModel>
}

/**
 * loads library data by importing and traversing @highstate/library
 * provides component and entity models needed for BlueprintCanvas
 */
export async function loadLibrary(): Promise<LibraryData> {
  const library = await import("@highstate/library")
  
  const components: Record<string, ComponentModel> = {}
  const entities: Record<string, EntityModel> = {}

  await _traverseLibrary(library, components, entities)

  return { components, entities }
}

async function _traverseLibrary(
  value: unknown, 
  components: Record<string, ComponentModel>,
  entities: Record<string, EntityModel>
): Promise<void> {
  if (isComponent(value)) {
    const component = value as Component
    components[component.model.type] = component.model
    
    // collect entities from this component
    for (const entity of component.entities.values()) {
      entities[entity.type] = entity.model
    }
    return
  }

  if (typeof value !== "object" || value === null) {
    return
  }

  if ("_zod" in value) {
    // this is a zod schema, skip it
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      await _traverseLibrary(item, components, entities)
    }
    return
  }

  for (const key in value) {
    await _traverseLibrary((value as Record<string, unknown>)[key], components, entities)
  }
}