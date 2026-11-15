<script setup lang="ts">
import type {
  CollectionQuery,
  RuntimeSettingsKind,
  RuntimeSettingsOutputs,
} from "@highstate/backend/shared"
import {
  baseHeaders,
  queryRuntimeSettings,
  SettingsDataTable,
  SettingsListPage,
  TableItemAction,
} from "#layers/core/app/features/settings"
import RuntimeSettingsDialog from "#layers/core/app/features/settings/components/RuntimeSettingsDialog.vue"

const props = defineProps<{
  kind: RuntimeSettingsKind
  title: string
  icon: string
  description: string
}>()

const store = useRuntimeSettingsStore()
const kind = computed(() => props.kind)
const visible = ref(false)
const selected = shallowRef<RuntimeSettingsOutputs[RuntimeSettingsKind] | null>(null)
const deleteTarget = shallowRef<RuntimeSettingsOutputs[RuntimeSettingsKind] | null>(null)
const deleteVisible = ref(false)
const deleting = ref(false)
const deleteError = ref("")
const error = computed(() => store.error)
const search = ref("")
const page = ref(1)
const itemsPerPage = ref(20)
const sortBy = ref<CollectionQuery["sortBy"]>([{ key: "meta.title", order: "asc" }])

const headers = [baseHeaders.name, baseHeaders.id, baseHeaders.actions]

const items = computed(
  () =>
    ({
      "container-runtime": store.runtimes,
      "pulumi-state-backend": store.stateBackends,
      "npm-registry-credential": store.npmCredentials,
      "container-registry-credential": store.ociCredentials,
    })[kind.value],
)

const data = computed(() =>
  queryRuntimeSettings(items.value, search.value, sortBy.value, page.value, itemsPerPage.value),
)

watch([kind, search, itemsPerPage], () => {
  page.value = 1
})

watch(
  () => data.value.total,
  total => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(total / itemsPerPage.value)))
  },
)

function edit(item: typeof selected.value) {
  selected.value = item
  visible.value = true
}

function confirmDelete(item: RuntimeSettingsOutputs[RuntimeSettingsKind]) {
  deleteTarget.value = item
  deleteError.value = ""
  deleteVisible.value = true
}

async function remove() {
  if (!deleteTarget.value || deleting.value) {
    return
  }

  deleting.value = true
  deleteError.value = ""

  try {
    await store.remove(kind.value, deleteTarget.value.id, deleteTarget.value.revision)
    deleteVisible.value = false
    deleteTarget.value = null
  } catch (caught) {
    deleteError.value = caught instanceof Error ? caught.message : "Failed to delete setting"
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <SettingsListPage :title="title" :icon="icon" :description="description">
    <template #actions>
      <VBtn
        color="primary"
        prepend-icon="mdi-plus"
        :disabled="store.loading || !!error"
        @click="edit(null)"
        >Create</VBtn
      >
    </template>
    <template #default="{ height }">
      <VAlert v-if="error" type="error" density="compact" class="mb-4">{{ error }}</VAlert>
      <SettingsDataTable
        v-model:search="search"
        v-model:sort-by="sortBy"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :data="data"
        :headers="headers"
        :loading="store.loading"
        :height="height"
      >
        <template #item.actions="{ item }">
          <div class="d-flex justify-center ga-1">
            <TableItemAction icon="mdi-pencil-outline" tooltip="Edit setting" @click="edit(item)" />
            <TableItemAction
              icon="mdi-delete-outline"
              tooltip="Delete setting"
              color="error"
              @click="confirmDelete(item)"
            />
          </div>
        </template>
      </SettingsDataTable>
    </template>
  </SettingsListPage>
  <RuntimeSettingsDialog v-model="visible" :kind="kind" :item="selected" />
  <VDialog v-model="deleteVisible" max-width="480" :persistent="deleting">
    <VCard title="Delete setting">
      <VCardText>
        <VAlert v-if="deleteError" type="error" density="compact" class="mb-4"
          >{{ deleteError }}</VAlert
        >
        This permanently deletes "{{ deleteTarget?.meta.title }}". Referenced settings cannot be
        deleted.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
