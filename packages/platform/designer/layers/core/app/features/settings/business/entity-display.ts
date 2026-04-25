import type { EntityModel } from "@highstate/contract"
import {
  getEntityOverrideMetaFromContent,
  pickEntityUiMeta,
  resolveEntityDisplay,
} from "#layers/core/app/features/entity-explorer"

type EntityMap = Record<string, EntityModel | undefined>

export const getSettingsEntityDisplayFromMeta = (options: {
  entities?: EntityMap
  entityType: string
  meta: unknown
}) => {
  const entities = options.entities ?? {}

  return resolveEntityDisplay({
    entityType: options.entityType,
    modelMeta: entities[options.entityType]?.meta,
    overrideMeta: pickEntityUiMeta(options.meta),
  })
}

export const getSettingsEntityDisplayFromContent = (options: {
  entities?: EntityMap
  entityType: string
  content: unknown
}) => {
  const entities = options.entities ?? {}

  return resolveEntityDisplay({
    entityType: options.entityType,
    modelMeta: entities[options.entityType]?.meta,
    overrideMeta: getEntityOverrideMetaFromContent(options.content),
  })
}
