<script setup lang="ts">
import { SettingsListPage } from "#layers/core/app/features/settings"
import { InstanceStatusBadge } from "#layers/core/app/features/instance-status"
import { Icon } from "@iconify/vue"
import type { InstanceId, InstanceModel, ObjectMeta } from "@highstate/contract"

const { projectStore, instancesStore, libraryStore, stateStore, validationStore, infoStore } =
  useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

definePageMeta({
  name: "settings.instances",
  tab: {
    label: "Instances",
    icon: "mdi-cube-outline",
    order: 10,
  },
})

const search = ref("")
const lazySearch = debouncedRef(search, 300)

type TreeNode = InstanceModel & {
  meta: ObjectMeta
  children?: TreeNode[]
}

const treeData = computed(() => {
  const allInstances = [...instancesStore.instances.values()]
  const lowerSearch = lazySearch.value.toLowerCase().trim()

  const filteredInstances = lowerSearch
    ? allInstances.filter(instance => instance.id.includes(lowerSearch))
    : allInstances

  const instancesWithMeta = filteredInstances.map(instance => {
    const component = libraryStore.library.components[instance.type]

    return {
      ...instance,
      meta: {
        title: component.meta.title,
        description: instance.name,
        color: component.meta.color,
        icon: component.meta.icon ?? "iconamoon:component",
        iconColor: component.meta.iconColor,
        secondaryIcon: component.meta.secondaryIcon,
        secondaryIconColor: component.meta.secondaryIconColor,
      } satisfies ObjectMeta,
    }
  })

  // build tree structure using parentId
  const rootInstances = instancesWithMeta.filter(instance => !instance.parentId)

  const buildTree = (instances: typeof instancesWithMeta): TreeNode[] => {
    return instances.map(instance => {
      const children = instancesWithMeta.filter(child => child.parentId === instance.id)
      return {
        ...instance,
        children: children.length > 0 ? buildTree(children) : undefined,
      }
    })
  }

  return buildTree(rootInstances)
})

// create project root node with all instances as children
const projectTreeData = computed(() => {
  if (!infoStore.projectInfo) {
    return []
  }

  const project = infoStore.projectInfo

  return [
    {
      id: project.id,
      meta: {
        title: project.meta.title || project.name,
        description: project.id,
        icon: project.meta.icon || "mdi-folder-outline",
        iconColor: project.meta.iconColor,
      },
      children: treeData.value,
    },
  ]
})

const handleItemClick = (item: TreeNode) => {
  if (item.id === infoStore.projectInfo?.id) {
    return
  }

  const state = stateStore.getInstanceState(item.id)
  if (state) {
    navigateTo({
      name: "settings.instance-details",
      params: { projectId: projectStore.projectId, stateId: state.id },
    })
  }
}
</script>

<template>
  <SettingsListPage
    title="Instances"
    icon="mdi-cube-outline"
    description="View and manage instances created in this project."
  >
    <template #default="{ height }">
      <div class="instances-tree" :style="{ height, display: 'flex', flexDirection: 'column' }">
        <!-- Search and Summary -->
        <div class="d-flex align-center justify-space-between mb-4" style="flex-shrink: 0">
          <div class="d-flex align-center">
            <VIcon class="mr-2">mdi-format-list-bulleted</VIcon>
            <span class="text-subtitle-1 font-weight-medium">
              {{ instancesStore.instances.size }} instance{{
                instancesStore.instances.size === 1 ? "" : "s"
              }}
            </span>
          </div>

          <VTextField
            v-model="search"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search instances..."
            variant="outlined"
            density="compact"
            clearable
            hide-details
            style="max-width: 300px"
          />
        </div>

        <!-- Tree View -->
        <div style="flex: 1; min-height: 0; overflow-y: auto">
          <VTreeview
            :items="projectTreeData"
            item-title="meta.title"
            item-value="id"
            open-strategy="multiple"
            select-strategy="independent"
            density="compact"
            indent-lines
            :opened="[infoStore.projectInfo?.id]"
          >
            <template #prepend="{ item, isOpen }">
              <!-- Status Badge for instances, folder icon for project root -->
              <div class="mr-2">
                <InstanceStatusBadge
                  v-if="item.id !== infoStore.projectInfo?.id"
                  :state="stateStore.instanceStates.get(item.id as InstanceId)"
                  :expected-input-hash="stateStore.inputHashOutputs.get(item.id)?.inputHash"
                  :validation-output="validationStore.validationOutputs.get(item.id)"
                />
                <VIcon
                  v-else
                  :icon="isOpen ? 'mdi-folder-open-outline' : 'mdi-folder-outline'"
                  size="20"
                  :color="item.meta.iconColor"
                />
              </div>
            </template>

            <template #title="{ item }">
              <div
                class="d-flex align-center flex-grow-1"
                style="cursor: pointer"
                @click="handleItemClick(item as TreeNode)"
              >
                <!-- Icon near title & description (only for instances, not project root) -->
                <Icon
                  v-if="item.meta.icon && item.id !== infoStore.projectInfo?.id"
                  :icon="item.meta.icon"
                  :color="item.meta.iconColor"
                  width="24"
                  class="mr-3"
                />

                <!-- Name and Description -->
                <div class="d-flex flex-column flex-grow-1 mr-4">
                  <div
                    class="font-weight-medium"
                    :class="item.id === infoStore.projectInfo?.id ? 'text-h6' : 'text-body-1'"
                  >
                    {{ item.meta.title || "Unnamed" }}
                  </div>
                  <div v-if="item.meta.description" class="text-caption text-medium-emphasis">
                    {{ item.meta.description }}
                  </div>
                </div>
              </div>
            </template>
          </VTreeview>
        </div>
      </div>
    </template>
  </SettingsListPage>
</template>
