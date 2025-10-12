<script setup lang="ts">
import type { OperationType, OperationOptions } from "@highstate/backend/shared"

const options = defineModel<OperationOptions>("options", { default: {} })

const { operation } = defineProps<{
  operation: OperationType
}>()

type OptionConfig = {
  key: keyof OperationOptions
  label: string
  description: string
  warning?: string
  showForOperations?: OperationType[]
  defaultValue?: boolean
}

const optionConfigs: OptionConfig[] = [
  {
    key: "forceUpdateDependencies",
    label: "Force update dependencies",
    description:
      "Force update all dependencies regardless of their current state. Bypasses hash-based change detection for dependency chains.",
    showForOperations: ["update"],
  },
  {
    key: "ignoreDependencies",
    label: "Ignore dependencies",
    description:
      "Skip dependency inclusion entirely. Only the requested instances are operated on, even if their dependencies are outdated or failed.",
    warning:
      "Ignoring dependencies will skip undeployed or failed prerequisites. Expect the operation to fail unless every required instance is handled manually.",
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
    showForOperations: ["destroy"],
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

const visibleOptions = computed(() => {
  return optionConfigs.filter(config => {
    if (!config.showForOperations) return true
    return config.showForOperations.includes(operation)
  })
})

const updateOption = (key: keyof OperationOptions, value: boolean | null) => {
  const resolvedValue = value ?? false

  if (key === "forceUpdateDependencies" && resolvedValue) {
    options.value.ignoreDependencies = false
  }

  if (key === "ignoreDependencies" && resolvedValue) {
    options.value.forceUpdateDependencies = false
  }

  options.value[key] = resolvedValue
}
</script>

<template>
  <div v-if="options">
    <template v-for="config in visibleOptions" :key="config.key">
      <VCheckbox
        :model-value="options[config.key]"
        @update:model-value="value => updateOption(config.key, value)"
        :class="config === visibleOptions[0] ? 'mt-2' : ''"
        :label="config.label"
        density="compact"
        hide-details
      />

      <div class="text-caption">
        {{ config.description }}
      </div>
    </template>

    <!-- Warning alerts -->
    <template v-for="config in visibleOptions" :key="`warning-${config.key}`">
      <VAlert
        v-if="config.warning && (options as any)[config.key]"
        density="compact"
        type="warning"
        variant="outlined"
        class="mt-4"
      >
        {{ config.warning }}
      </VAlert>
    </template>
  </div>
</template>
