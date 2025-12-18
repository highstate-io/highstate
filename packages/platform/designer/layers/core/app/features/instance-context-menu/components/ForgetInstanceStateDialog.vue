<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import { Icon } from "@iconify/vue"

const visible = defineModel<boolean>("visible")

const { stateStore, libraryStore } = useProjectStores()

const { instances } = defineProps<{
  instances: InstanceModel[]
}>()

const isMultipleInstances = computed(() => instances.length > 1)
const firstInstance = computed(() => instances[0])

const loading = ref(false)
const deleteSecrets = ref(false)
const clearTerminalData = ref(false)

type InstanceNode = {
  id: string
  title: string
  subtitle: string
  icon: string
  iconColor?: string
}

const instanceNodes = computed<InstanceNode[]>(() => {
  return instances.map(inst => {
    const component = libraryStore.library.components?.[inst.type]

    return {
      id: inst.id,
      title: component ? `${component.meta.title} "${inst.name}"` : `${inst.type} "${inst.name}"`,
      subtitle: inst.id,
      icon: component?.meta.icon ?? "iconamoon:component",
      iconColor: component?.meta.iconColor,
    }
  })
})

const forgetState = async () => {
  loading.value = true

  try {
    await stateStore.forgetInstanceStates(
      instances.map(inst => inst.id),
      deleteSecrets.value,
      clearTerminalData.value,
    )

    visible.value = false
  } finally {
    loading.value = false
  }
}

const title = computed(() => {
  if (instances.length === 0) {
    return "Forget state"
  }

  if (!isMultipleInstances.value) {
    const inst = firstInstance.value

    const component = libraryStore.library.components?.[inst.type]
    if (component) {
      return `Forget state of ${component.meta.title} "${inst.name}"`
    }

    return `Forget state of ${inst.type} "${inst.name}"`
  }

  return `Forget state of ${instances.length} instances`
})
</script>

<template>
  <VDialog v-model="visible" max-width="1200px" class="forget-dialog">
    <VCard :title="title" color="#2d2d2d" class="forget-card">
      <VCardText class="forget-card-content">
        <VContainer fluid class="pa-0 fill-height">
          <VRow no-gutters class="fill-height">
            <VCol cols="12" md="5" class="pr-md-4 column-container">
              <div class="text-overline mb-2">Options</div>

              <VCheckbox
                v-model="deleteSecrets"
                label="Delete all secrets associated with this instance"
                density="compact"
                hide-details
              />

              <VCheckbox
                v-model="clearTerminalData"
                label="Clear all terminal data associated with this instance"
                density="compact"
                hide-details
              />

              <VAlert density="compact" type="warning" variant="outlined" class="mt-4 alert-auto">
                <div>
                  No destroy operation will be performed, so all resources will be left in place and
                  unreachable by HighState.
                </div>
                <div>
                  You should only use this operation when the instance is unreachable/unrecoverable
                  and you want to start from scratch.
                </div>
              </VAlert>
            </VCol>

            <VDivider vertical class="d-none d-md-flex" />

            <VCol cols="12" md="7" class="pl-md-4 mt-4 mt-md-0 column-container">
              <div class="text-overline mb-2">Instances</div>
              <div class="tree-scrollable">
                <VTreeview
                  :items="instanceNodes"
                  item-title="title"
                  item-value="id"
                  density="compact"
                  bg-color="#2d2d2d"
                  class="forget-instance-tree"
                >
                  <template #prepend="{ item }">
                    <Icon :icon="item.icon" :color="item.iconColor" width="20" class="mr-2" />
                  </template>

                  <template #title="{ item }">
                    <div class="d-flex flex-column">
                      <div class="text-body-2 font-weight-regular">{{ item.title }}</div>
                      <div class="text-caption text-medium-emphasis">{{ item.subtitle }}</div>
                    </div>
                  </template>
                </VTreeview>
              </div>
            </VCol>
          </VRow>
        </VContainer>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn @click="visible = false">Cancel</VBtn>
        <VBtn :loading="loading" @click="forgetState">
          Forget State{{ isMultipleInstances ? ` (${instances.length})` : "" }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.forget-dialog :deep(.v-overlay__content) {
  height: 80vh;
  max-height: 80vh;
}

.forget-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.forget-card-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.tree-scrollable {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.alert-auto {
  flex: 0 0 auto;
  align-self: flex-start;
}

.forget-instance-tree {
  --v-treeview-level: 0px;
  padding-left: 0;
}

.forget-instance-tree :deep(.v-treeview-node__root) {
  padding-inline-start: 0;
  margin-left: -8px;
}

.forget-instance-tree :deep(.v-treeview-node__append) {
  display: none;
}

@media (max-width: 960px) {
  .column-container {
    height: auto;
  }

  .tree-scrollable {
    max-height: 300px;
  }
}

@media (max-width: 600px) {
  .forget-dialog :deep(.v-overlay__content) {
    height: 90vh;
    max-height: 90vh;
  }
}
</style>
