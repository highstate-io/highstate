export type EntityUiMeta = {
  title?: string
  icon?: string
  iconColor?: string
  secondaryIcon?: string
  secondaryIconColor?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const pickEntityUiMeta = (value: unknown): EntityUiMeta => {
  if (!isRecord(value)) {
    return {}
  }

  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.icon === "string" ? { icon: value.icon } : {}),
    ...(typeof value.iconColor === "string" ? { iconColor: value.iconColor } : {}),
    ...(typeof value.secondaryIcon === "string" ? { secondaryIcon: value.secondaryIcon } : {}),
    ...(typeof value.secondaryIconColor === "string"
      ? { secondaryIconColor: value.secondaryIconColor }
      : {}),
  }
}

export const getEntityOverrideMetaFromContent = (content: unknown): EntityUiMeta => {
  if (!isRecord(content)) {
    return {}
  }

  return pickEntityUiMeta(content.$meta)
}

export const resolveEntityDisplay = (options: {
  entityType: string
  modelMeta?: EntityUiMeta
  overrideMeta?: EntityUiMeta
}) => {
  const { entityType, modelMeta, overrideMeta } = options
  const effectiveOverrideMeta = overrideMeta ?? {}

  return {
    title: modelMeta?.title ?? entityType,
    subtitle: effectiveOverrideMeta.title,
    metaForIcon: effectiveOverrideMeta.icon ? effectiveOverrideMeta : modelMeta,
  }
}
