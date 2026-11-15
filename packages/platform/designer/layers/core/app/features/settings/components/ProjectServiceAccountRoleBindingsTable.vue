<script setup lang="ts">
import type { ProjectRoleBindingOutput, ProjectRoleOutput } from "@highstate/backend/shared"
import TableItemAction from "./TableItemAction.vue"
import TimeTableCell from "./TimeTableCell.vue"

const { projectId, serviceAccountId, readonly } = defineProps<{
  projectId: string
  serviceAccountId: string
  readonly?: boolean
}>()

const count = defineModel<number>("count", { default: 0 })
const { $client } = useNuxtApp()

const bindings = ref<ProjectRoleBindingOutput[]>([])
const roles = ref<ProjectRoleOutput[]>([])
const selectedRoleIds = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const boundRoles = computed(() => {
  const bindingByRoleId = new Map(bindings.value.map(binding => [binding.roleId, binding]))

  return roles.value
    .filter(role => bindingByRoleId.has(role.id))
    .map(role => ({ ...role, binding: bindingByRoleId.get(role.id)! }))
})

const availableRoles = computed(() => {
  const boundIds = new Set(bindings.value.map(binding => binding.roleId))

  return roles.value.filter(role => !boundIds.has(role.id))
})

async function load(): Promise<void> {
  loading.value = true

  try {
    const loadedBindings = await $client.projectServiceAccountSettings.getRoleBindings.query({
      projectId,
      serviceAccountId,
    })

    const loadedRoles = await loadAllCollectionItems(query =>
      $client.projectRoleSettings.query.query({ projectId, query }),
    )

    bindings.value = loadedBindings
    roles.value = loadedRoles
    count.value = loadedBindings.length
    error.value = null
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load role bindings"
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  if (!selectedRoleIds.value.length) {
    return
  }

  loading.value = true

  try {
    for (const roleId of [...selectedRoleIds.value]) {
      await $client.projectServiceAccountSettings.addRoleBinding.mutate({
        projectId,
        serviceAccountId,
        roleId,
      })

      selectedRoleIds.value = selectedRoleIds.value.filter(id => id !== roleId)
    }

    await load()
  } catch (caught) {
    await load()
    error.value = caught instanceof Error ? caught.message : "Failed to update role bindings"
  } finally {
    loading.value = false
  }
}

async function remove(roleId: string): Promise<void> {
  loading.value = true

  try {
    await $client.projectServiceAccountSettings.removeRoleBinding.mutate({
      projectId,
      serviceAccountId,
      roleId,
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
        v-model="selectedRoleIds"
        :items="availableRoles"
        item-title="meta.title"
        item-value="id"
        label="Roles"
        multiple
        chips
        closable-chips
        density="compact"
        variant="outlined"
        hide-details
        :disabled="readonly || loading"
      />
      <VBtn
        class="binding-action"
        color="primary"
        :disabled="readonly || loading || !selectedRoleIds.length"
        :loading="loading"
        @click="add"
        v-access="{ permission: 'role-binding.create', projectId }"
      >
        Add
      </VBtn>
    </div>
    <VTable>
      <thead>
        <tr>
          <th>Role</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in boundRoles" :key="role.id">
          <td>{{ role.meta.title }}</td>
          <td>
            <TimeTableCell :value="role.binding.createdAt" />
          </td>
          <td class="text-right">
            <TableItemAction
              icon="mdi-delete-outline"
              :tooltip="`Remove ${role.meta.title}`"
              :disabled="readonly || loading"
              @click="remove(role.id)"
              :access="{ permission: 'role-binding.delete', projectId }"
            />
          </td>
        </tr>
        <tr v-if="!loading && boundRoles.length === 0">
          <td colspan="3" class="text-center text-medium-emphasis py-4">No roles</td>
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
