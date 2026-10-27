<script setup lang="ts">
import type { RuntimeSettingsKind, RuntimeSettingsOutputs } from "@highstate/backend/shared"
import RuntimeSettingsDialog from "#layers/core/app/features/settings/components/RuntimeSettingsDialog.vue"

definePageMeta({
  name: "settings.runtime",
  tab: { label: "Runtime & Registries", icon: "mdi-server-network", order: 3 },
})

const store = useRuntimeSettingsStore()
const kind = ref<RuntimeSettingsKind>("container-runtime")
const visible = ref(false)
const selected = shallowRef<RuntimeSettingsOutputs[RuntimeSettingsKind] | null>(null)
const error = ref("")
const search = ref("")
const kinds = [
  { value: "container-runtime", title: "Container runtimes" },
  { value: "pulumi-state-backend", title: "Pulumi state backends" },
  { value: "npm-registry-credential", title: "npm credentials" },
  { value: "container-registry-credential", title: "OCI credentials" },
]
const items = computed(
  () =>
    ({
      "container-runtime": store.runtimes,
      "pulumi-state-backend": store.stateBackends,
      "npm-registry-credential": store.npmCredentials,
      "container-registry-credential": store.ociCredentials,
    })[kind.value],
)

async function load() {
  error.value = ""
  try {
    await store.load()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load runtime settings"
  }
}
function edit(item: typeof selected.value) {
  selected.value = item
  visible.value = true
}
onMounted(load)
</script>

<template>
  <div class="d-flex flex-column h-100 overflow-y-auto">
    <h2 class="mb-2">Runtime & Registries</h2>
    <p class="mb-4">
      Configure container execution, Pulumi state storage, and registry credentials.
    </p>
    <VAlert v-if="error" type="error" class="mb-4">{{ error }}</VAlert>
    <VSelect v-model="kind" :items="kinds" label="Settings category" class="flex-grow-0" />
    <div class="d-flex ga-2 mb-4">
      <VTextField v-model="search" label="Search" hide-details density="compact" />
      <VBtn :loading="store.loading" @click="load">Refresh</VBtn>
      <VBtn color="primary" :disabled="store.loading || !!error" @click="edit(null)">Create</VBtn>
    </div>
    <VDataTable
      :items="items"
      :search="search"
      :loading="store.loading"
      :headers="[
      { title: 'Title', key: 'meta.title' }, { title: 'ID', key: 'id' },
      { title: 'Revision', key: 'revision' }, { title: 'Actions', key: 'actions', sortable: false },
    ]"
    >
      <template #item.actions="{ item }">
        <VBtn size="small" variant="text" @click="edit(item)">Edit</VBtn>
      </template>
    </VDataTable>
    <RuntimeSettingsDialog v-model="visible" :kind="kind" :item="selected" @changed="load" />
  </div>
</template>
