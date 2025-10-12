import type { ComponentModel } from "@highstate/contract"

export function getComponentNamePrefix(component: ComponentModel) {
  return component.meta.defaultNamePrefix ?? component.type.split(".").pop()
}
