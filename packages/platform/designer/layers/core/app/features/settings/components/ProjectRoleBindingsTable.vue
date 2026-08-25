<script setup lang="ts">
import type { ProjectRoleBindingOutput, ServiceAccountOutput } from "@highstate/backend/shared"
import TimeTableCell from "./TimeTableCell.vue"

const { projectId, roleId, readonly } = defineProps<{
  projectId: string
  roleId: string
  readonly?: boolean
}>()
const count = defineModel<number>("count", { default: 0 })
const { $client } = useNuxtApp()

const bindings = ref<ProjectRoleBindingOutput[]>([])
const accounts = ref<ServiceAccountOutput[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const bound = computed(() => {
  const bindingByServiceAccountId = new Map(
    bindings.value.map(binding => [binding.serviceAccountId, binding]),
  )

  return accounts.value
    .filter(account => bindingByServiceAccountId.has(account.id))
    .map(account => ({ ...account, binding: bindingByServiceAccountId.get(account.id)! }))
})

const available = computed(() => {
  const boundIds = new Set(bindings.value.map(binding => binding.serviceAccountId))

  return accounts.value.filter(account => !account.systemName && !boundIds.has(account.id))
})

async function load(): Promise<void> {
  loading.value = true

  try {
    const loadedBindings = await $client.projectServiceAccountSettings.getRoleBindingsByRole.query({
      projectId,
      roleId,
    })
    const loadedAccounts = await loadAllCollectionItems(query =>
      $client.projectServiceAccountSettings.query.query({ projectId, query }),
    )

    bindings.value = loadedBindings
    accounts.value = loadedAccounts
    count.value = loadedBindings.length
    error.value = null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load role bindings"
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  if (!selectedId.value) {
    return
  }

  loading.value = true

  try {
    await $client.projectServiceAccountSettings.addRoleBinding.mutate({
      projectId,
      roleId,
      serviceAccountId: selectedId.value,
    })
    selectedId.value = null
    await load()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to update role bindings"
  } finally {
    loading.value = false
  }
}

async function remove(serviceAccountId: string): Promise<void> {
  loading.value = true

  try {
    await $client.projectServiceAccountSettings.removeRoleBinding.mutate({
      projectId,
      roleId,
      serviceAccountId,
    })
    await load()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to update role bindings"
  } finally {
    loading.value = false
  }
}

await load()
</script>

<template>
  <div class="pa-4">
    <VAlert v-if="error" type="error" density="compact" class="mb-4">{{ error }}</VAlert>
    <div class="binding-form mb-6">
      <VSelect
        v-model="selectedId"
        :items="available"
        item-title="meta.title"
        item-value="id"
        label="Service account"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="readonly || loading"
      />
      <VBtn
        class="binding-action"
        color="primary"
        :disabled="readonly || !selectedId"
        :loading="loading"
        @click="add"
      >
        Add
      </VBtn>
    </div>
    <VTable>
      <thead>
        <tr>
          <th>Service account</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in bound" :key="account.id">
          <td>{{ account.meta.title }}</td>
          <td>
            <TimeTableCell :value="account.binding.createdAt" />
          </td>
          <td class="text-right">
            <VBtn
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              :disabled="readonly || !!account.systemName"
              @click="remove(account.id)"
            />
          </td>
        </tr>
        <tr v-if="!loading && bound.length === 0">
          <td colspan="3" class="text-center text-medium-emphasis py-4">No service accounts</td>
        </tr>
      </tbody>
    </VTable>
  </div>
</template>

<style scoped>
.binding-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.binding-action {
  min-height: 40px;
}

@media (max-width: 600px) {
  .binding-form {
    grid-template-columns: 1fr;
  }
}
</style>
