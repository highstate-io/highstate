import { type ComponentModel, type EntityModel, z } from "@highstate/contract"

export const librarySpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host"),
  }),
])

export type LibrarySpec = z.infer<typeof librarySpecSchema>

export type LibraryModel = {
  components: Record<string, ComponentModel>
  entities: Record<string, EntityModel>
}

export type LibraryUpdate =
  | {
      type: "reload-started" | "reload-completed"
    }
  | {
      type: "component-updated"
      component: ComponentModel
    }
  | {
      type: "entity-updated"
      entity: EntityModel
    }
  | {
      type: "component-removed"
      componentType: string
    }
  | {
      type: "entity-removed"
      entityType: string
    }

export function diffLibraries(oldLibrary: LibraryModel, newLibrary: LibraryModel): LibraryUpdate[] {
  const updates: LibraryUpdate[] = []

  for (const [componentType, newComponent] of Object.entries(newLibrary.components)) {
    const existingComponent = oldLibrary.components[componentType]
    if (existingComponent?.definitionHash !== newComponent.definitionHash) {
      updates.push({ type: "component-updated", component: newComponent })
    }
  }

  for (const componentType of Object.keys(oldLibrary.components)) {
    if (!newLibrary.components[componentType]) {
      updates.push({ type: "component-removed", componentType })
    }
  }

  for (const [entityType, newEntity] of Object.entries(newLibrary.entities)) {
    const existingEntity = oldLibrary.entities[entityType]
    if (existingEntity?.definitionHash !== newEntity.definitionHash) {
      updates.push({ type: "entity-updated", entity: newEntity })
    }
  }

  for (const entityType of Object.keys(oldLibrary.entities)) {
    if (!newLibrary.entities[entityType]) {
      updates.push({ type: "entity-removed", entityType })
    }
  }

  return updates
}

export function applyLibraryUpdate(
  components: Record<string, ComponentModel>,
  entities: Record<string, EntityModel>,
  update: LibraryUpdate,
): void {
  switch (update.type) {
    case "component-updated":
      components[update.component.type] = update.component
      break
    case "entity-updated":
      entities[update.entity.type] = update.entity
      break
    case "component-removed":
      delete components[update.componentType]
      break
    case "entity-removed":
      delete entities[update.entityType]
      break
  }
}
