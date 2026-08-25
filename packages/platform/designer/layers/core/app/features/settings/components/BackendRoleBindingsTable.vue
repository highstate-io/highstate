<script setup lang="ts">
import type {
  BackendServiceAccountOutput,
  ServiceAccountBackendRoleBindingOutput,
} from "@highstate/backend/shared"
import TimeTableCell from "./TimeTableCell.vue"

const { roleId, readonly } = defineProps<{ roleId: string; readonly?: boolean }>()
const count = defineModel<number>("count", { default: 0 })
const { $client } = useNuxtApp()

const bindings = ref<ServiceAccountBackendRoleBindingOutput[]>([])
const serviceAccounts = ref<BackendServiceAccountOutput[]>([])
const selectedServiceAccountId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const boundServiceAccounts = computed(() => {
  const bindingByServiceAccountId = new Map(
    bindings.value.map(binding => [binding.serviceAccountId, binding]),
  )

  return serviceAccounts.value
    .filter(serviceAccount => bindingByServiceAccountId.has(serviceAccount.id))
    .map(serviceAccount => ({
      ...serviceAccount,
      binding: bindingByServiceAccountId.get(serviceAccount.id)!,
    }))
})

const availableServiceAccounts = computed(() => {
  const boundIds = new Set(bindings.value.map(binding => binding.serviceAccountId))

  return serviceAccounts.value.filter(
    serviceAccount => !boundIds.has(serviceAccount.id) && !serviceAccount.systemName,
  )
})

async function load(): Promise<void> {
  loading.value = true

  try {
    const loadedBindings = await $client.backendServiceAccountSettings.getRoleBindingsByRole.query({
      roleId,
    })
    const loadedServiceAccounts = await loadAllCollectionItems(query =>
      $client.backendServiceAccountSettings.query.query(query),
    )

    bindings.value = loadedBindings
    count.value = loadedBindings.length
    serviceAccounts.value = loadedServiceAccounts
    error.value = null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load role bindings"
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  if (!selectedServiceAccountId.value) {
    return
  }

  loading.value = true

  try {
    await $client.backendServiceAccountSettings.addRoleBinding.mutate({
      roleId,
      serviceAccountId: selectedServiceAccountId.value,
    })
    selectedServiceAccountId.value = null
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
    await $client.backendServiceAccountSettings.removeRoleBinding.mutate({
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
        v-model="selectedServiceAccountId"
        :items="availableServiceAccounts"
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
        :disabled="readonly || !selectedServiceAccountId"
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
        <tr v-for="serviceAccount in boundServiceAccounts" :key="serviceAccount.id">
          <td>{{ serviceAccount.meta.title }}</td>
          <td>
            <TimeTableCell :value="serviceAccount.binding.createdAt" />
          </td>
          <td class="text-right">
            <VBtn
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              :disabled="readonly || !!serviceAccount.systemName"
              @click="remove(serviceAccount.id)"
            />
          </td>
        </tr>
        <tr v-if="!loading && boundServiceAccounts.length === 0">
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
