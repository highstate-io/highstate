import type { InstanceModel } from "@highstate/contract"
import type { OperationType } from "@highstate/backend/shared"

/**
 * Generates an operation title for a single instance
 */
export function generateOperationTitle(type: OperationType, instance: InstanceModel): string {
  const actionName = getActionName(type)
  return `${actionName} ${instance.name}`
}

/**
 * Generates an operation title for multiple instances
 */
export function generateMultipleInstancesOperationTitle(
  type: OperationType,
  instances: InstanceModel[],
): string {
  const actionName = getActionName(type)
  return `${actionName} ${instances.length} instances`
}

/**
 * Gets the human-readable action name for an operation type
 */
function getActionName(type: OperationType): string {
  switch (type) {
    case "update":
      return "Update"
    case "preview":
      return "Preview"
    case "destroy":
      return "Destroy"
    case "recreate":
      return "Recreate"
    case "refresh":
      return "Refresh"
  }
}
