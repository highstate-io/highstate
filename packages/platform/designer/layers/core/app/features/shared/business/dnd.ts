import type { VersionedName } from "@highstate/contract"

function hideDragGhost(dataTransfer: DataTransfer): void {
  const canvas = document.createElement("canvas")
  dataTransfer.setDragImage(canvas, 0, 0)
  canvas.remove()
}

export function setComponentDragData(dataTransfer: DataTransfer, componentType: string): void {
  hideDragGhost(dataTransfer)

  // we set the component type inside the "format" because
  // content of dataTransfer is not available in the dragover event
  dataTransfer.setData(`io.highstate.component:${componentType}`, "1")
}

export function setHubDragData(dataTransfer: DataTransfer): void {
  hideDragGhost(dataTransfer)
  dataTransfer.setData("io.highstate.hub", "1")
}

export function getComponentTypeFromDragData(dataTransfer: DataTransfer): VersionedName | null {
  const types = dataTransfer.types

  for (const type of types) {
    if (type.startsWith("io.highstate.component:")) {
      return type.slice("io.highstate.component:".length) as VersionedName
    }
  }

  return null
}

export function isHubDragData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("io.highstate.hub")
}
