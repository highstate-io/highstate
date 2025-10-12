<script setup lang="ts">
import type { OperationPhase, OperationPhaseInstance } from "@highstate/backend/shared"
import { Icon } from "@iconify/vue"

const { phases } = defineProps<{
  phases: OperationPhase[]
}>()

const { instancesStore, libraryStore } = useProjectStores()

type TreeNode = {
  id: string
  title: string
  subtitle: string
  icon: string
  iconColor?: string
  phaseType: string
  children?: TreeNode[]
}

const treeData = computed(() => {
  const nodes: TreeNode[] = []

  for (const phase of phases) {
    const phaseNode: TreeNode = {
      id: `phase-${phase.type}`,
      title: `${phase.type.charAt(0).toUpperCase() + phase.type.slice(1)} Phase`,
      subtitle: `${phase.instances.length} instance${phase.instances.length === 1 ? "" : "s"}`,
      icon: getPhaseIcon(phase.type),
      iconColor: getPhaseColor(phase.type),
      phaseType: phase.type,
      children: [],
    }

    const instancesWithChildren = buildInstanceTree(phase.instances)
    phaseNode.children = instancesWithChildren

    nodes.push(phaseNode)
  }

  return nodes
})

const buildInstanceTree = (instances: OperationPhaseInstance[]): TreeNode[] => {
  const instanceMap = new Map<
    string,
    OperationPhaseInstance & { children: OperationPhaseInstance[] }
  >()

  for (const instance of instances) {
    if (!instanceMap.has(instance.id)) {
      instanceMap.set(instance.id, { ...instance, children: [] })
    }
  }

  for (const instance of instances) {
    if (instance.parentId && instanceMap.has(instance.parentId)) {
      instanceMap.get(instance.parentId)!.children.push(instance)
    }
  }

  const rootInstances = instances.filter(
    instance => !instance.parentId || !instanceMap.has(instance.parentId),
  )

  return rootInstances.map(instance => createInstanceNode(instance, instanceMap))
}

const createInstanceNode = (
  instance: OperationPhaseInstance,
  instanceMap: Map<string, OperationPhaseInstance & { children: OperationPhaseInstance[] }>,
): TreeNode => {
  const instanceModel = instancesStore.instances.get(instance.id)
  const component = instanceModel ? libraryStore.library.components[instanceModel.type] : null

  const node: TreeNode = {
    id: instance.id,
    title:
      component && instanceModel ? `${component.meta.title} "${instanceModel.name}"` : instance.id,
    subtitle: instance.message,
    icon: component?.meta.icon ?? "iconamoon:component",
    iconColor: component?.meta.iconColor,
    phaseType: "instance",
  }

  const instanceWithChildren = instanceMap.get(instance.id)
  if (instanceWithChildren && instanceWithChildren.children.length > 0) {
    node.children = instanceWithChildren.children.map(child =>
      createInstanceNode(child, instanceMap),
    )
  }

  return node
}

const getPhaseIcon = (phaseType: string): string => {
  switch (phaseType) {
    case "preview":
      return "mdi-eye"
    case "destroy":
      return "mdi-delete"
    case "update":
      return "mdi-update"
    case "refresh":
      return "mdi-refresh"
    default:
      return "mdi-cog"
  }
}

const getPhaseColor = (phaseType: string): string => {
  switch (phaseType) {
    case "preview":
      return "secondary"
    case "destroy":
      return "error"
    case "update":
      return "primary"
    case "refresh":
      return "info"
    default:
      return "secondary"
  }
}
</script>

<template>
  <div v-if="phases.length > 0">
    <VTreeview
      :items="treeData"
      item-title="title"
      item-value="id"
      density="compact"
      open-all
      indent-lines
      bg-color="#2d2d2d"
    >
      <template #prepend="{ item }">
        <Icon :icon="item.icon" :color="item.iconColor" width="20" class="mr-2" />
      </template>

      <template #title="{ item }">
        <div class="d-flex flex-column">
          <div
            class="text-body-2"
            :class="item.phaseType === 'instance' ? 'font-weight-regular' : 'font-weight-medium'"
          >
            {{ item.title }}
          </div>
          <div v-if="item.subtitle" class="text-caption text-medium-emphasis">
            {{ item.subtitle }}
          </div>
        </div>
      </template>
    </VTreeview>
  </div>
  <div v-else class="text-body-2 text-medium-emphasis pa-4">
    No changes planned for this operation.
  </div>
</template>
