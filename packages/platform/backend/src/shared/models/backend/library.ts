import type { ComponentModel, EntityModel } from "@highstate/contract"
import { z } from "zod"

export const npmPackageNameSchema = z
  .string()
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)
  .refine(
    name => !["node_modules", "favicon.ico"].includes(name.split("/").at(-1)!),
    "Reserved npm package name",
  )

export const exactPackageVersionSchema = z
  .string()
  .max(256)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/,
  )
  .refine(
    version =>
      version
        .split(/[.+-]/)
        .slice(0, 3)
        .every(part => Number.isSafeInteger(Number(part))),
    "Invalid npm semantic version",
  )

export const libraryPackageInputSchema = z
  .object({ packageName: npmPackageNameSchema, version: exactPackageVersionSchema })
  .strict()

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
