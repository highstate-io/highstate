import type { OperationType, OperationOptions } from "@highstate/backend/shared"

export type OptionConfig = {
  key: keyof OperationOptions
  label: string
  description: string
  warning?: string
  showForOperations?: OperationType[]
  requiresCompositeTargets?: boolean
  defaultValue?: boolean
}

export const optionConfigs: OptionConfig[] = [
  {
    key: "forceUpdateDependencies",
    label: "Force update dependencies",
    description:
      "Force update all dependencies regardless of their current state. Bypasses hash-based change detection for dependency chains.",
    showForOperations: ["update"],
  },
  {
    key: "ignoreChangedDependencies",
    label: "Ignore changed dependencies",
    description:
      "Skip only changed dependencies. Failed or undeployed dependencies of selected instances are still included.",
    showForOperations: ["update"],
  },
  {
    key: "ignoreDependencies",
    label: "Ignore dependencies",
    description:
      "Skip all dependencies of selected instances, including failed and undeployed prerequisites. Operate only on explicitly selected instances.",
    warning:
      "This is manual mode. The operation may fail unless every required prerequisite instance is selected explicitly.",
    showForOperations: ["update"],
  },
  {
    key: "forceUpdateChildren",
    label: "Force update children instances",
    description:
      "Force update all children of composite instances regardless of their state. Overrides selective child inclusion logic.",
    showForOperations: ["update"],
  },
  {
    key: "onlyDestroyGhosts",
    label: "Only destroy ghosts",
    description:
      "Skip update phase and run only ghost cleanup destroy phase for affected composite instances.",
    showForOperations: ["update"],
    requiresCompositeTargets: true,
  },
  {
    key: "firstDestroyGhosts",
    label: "Destroy ghosts before update",
    description:
      "Run ghost cleanup destroy phase before update phase for affected composite instances.",
    showForOperations: ["update"],
    requiresCompositeTargets: true,
  },
  {
    key: "ignoreGhosts",
    label: "Ignore ghosts",
    description: "Skip ghost cleanup destroy phase for update operations.",
    showForOperations: ["update"],
    requiresCompositeTargets: true,
  },
  {
    key: "destroyDependentInstances",
    label: "Destroy dependent instances",
    description:
      "Include dependent instances when destroying instances. Traverses the dependency graph in reverse to prevent orphaned instances.",
    defaultValue: true,
    showForOperations: ["destroy", "recreate"],
  },
  {
    key: "invokeDestroyTriggers",
    label: "Invoke destroy triggers",
    description:
      "Execute destroy triggers when destroying instances. Controls trigger execution during the destruction phase.",
    defaultValue: true,
  },
  {
    key: "deleteUnreachableResources",
    label: "Delete unreachable resources",
    description:
      "Delete Pulumi resources that are no longer referenced in the state. Deletes orphaned resources within individual instances.",
    warning:
      "All resources that will not be reachable at the moment of the destroy operation will be removed from the state. Only use when you are sure that these resources do not actually exist!",
  },
  {
    key: "forceDeleteState",
    label: "Force delete state",
    description:
      "Force deletion of instance state even if the destroy operation fails. Bypasses normal destroy procedures as emergency fallback.",
    warning:
      "This will delete the stack state and all resources in it even if the destroy operation failed. Use only when the stack is unrecoverable and you want to start from scratch.",
    showForOperations: ["destroy", "recreate"],
  },
  {
    key: "allowPartialCompositeInstanceUpdate",
    label: "Allow partial update of composite instances",
    description:
      "Allow update of individual composite children without requiring all siblings. When enabled, only necessary children are included.",
    showForOperations: ["update", "recreate"],
  },
  {
    key: "allowPartialCompositeInstanceDestruction",
    label: "Allow partial destruction of composite instances",
    description:
      "Allow partial destruction of composite instances during cascade operations. When enabled, cascade destruction includes only directly dependent children.",
    showForOperations: ["destroy", "recreate"],
  },
  {
    key: "refresh",
    label: "Refresh state before operation",
    description:
      "Also refresh the state of instances during the operation. Synchronizes state with actual infrastructure.",
  },
  {
    key: "debug",
    label: "Enable debug logging",
    description:
      "Enable debug logging for Pulumi engine and resource providers. Sets TF_LOG=DEBUG for Terraform providers.",
    warning:
      "Debug mode may expose sensitive information including credentials in the logs. Use only when absolutely necessary for troubleshooting.",
  },
]

export const getVisibleOperationOptions = (
  operation: OperationType,
  options?: { compositeTargetsOnly?: boolean },
): OptionConfig[] => {
  return optionConfigs.filter(config => {
    if (config.requiresCompositeTargets && !options?.compositeTargetsOnly) {
      return false
    }

    if (!config.showForOperations) {
      return true
    }

    return config.showForOperations.includes(operation)
  })
}
