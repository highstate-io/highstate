<script setup lang="ts">
import type { BackendRoleInput, BackendRoleOutput } from "@highstate/backend/shared"
import {
  BackendRoleDialog,
  BackendRolesTable,
  SettingsListPage,
} from "#layers/core/app/features/settings"

const roleStore = useBackendRoleSettingsStore()
const router = useRouter()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const roleToDelete = ref<BackendRoleOutput | null>(null)
const saving = ref(false)
const deleting = ref(false)
const { state: restrictionOptions, execute: loadOptions } = useAsyncState(
  () => roleStore.getRestrictionOptions(),
  undefined,
  { immediate: false },
)
watch(dialogVisible, visible => {
  if (visible) {
    void loadOptions()
  }
})

definePageMeta({
  name: "settings.backend-roles",
  tab: {
    label: "Backend Roles",
    group: "Security",
    icon: "mdi-shield-account",
    order: 3,
    subpages: ["settings.backend-role-details"],
  },
})

async function save(input: BackendRoleInput): Promise<void> {
  saving.value = true

  try {
    const role = await roleStore.create(input)
    dialogVisible.value = false
    await router.push({ name: "settings.backend-role-details", params: { roleId: role.id } })
  } finally {
    saving.value = false
  }
}

function confirmDelete(role: BackendRoleOutput): void {
  roleToDelete.value = role
  deleteDialogVisible.value = true
}

async function remove(): Promise<void> {
  if (!roleToDelete.value) {
    return
  }

  deleting.value = true

  try {
    await roleStore.delete(roleToDelete.value.id)
    deleteDialogVisible.value = false
    roleToDelete.value = null
  } finally {
    deleting.value = false
  }
}

void roleStore.items.load()
</script>

<template>
  <SettingsListPage
    title="Backend Roles"
    icon="mdi-shield-account"
    description="Manage roles that grant backend-wide permissions to service accounts."
  >
    <template #actions>
      <VBtn
        v-access="{ permission: 'role.create' }"
        color="primary"
        prepend-icon="mdi-plus"
        @click="dialogVisible = true"
        >Create</VBtn
      >
    </template>
    <template #default="{ height }">
      <BackendRolesTable
        v-model:search="roleStore.items.search"
        v-model:sort-by="roleStore.items.sortBy"
        v-model:page="roleStore.items.page"
        v-model:items-per-page="roleStore.items.itemsPerPage"
        :data="roleStore.items.data"
        :loading="roleStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
      />
    </template>
  </SettingsListPage>

  <BackendRoleDialog
    v-if="restrictionOptions"
    v-model:visible="dialogVisible"
    :loading="saving"
    :restriction-options="restrictionOptions"
    @save="save"
  />

  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete backend role">
      <VCardText>
        This permanently deletes "{{ roleToDelete?.meta.title }}" and all of its bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn
          v-access="{ permission: 'role.delete', target: { resourceId: roleToDelete?.id } }"
          color="error"
          :loading="deleting"
          @click="remove"
          >Delete</VBtn
        >
      </VCardActions>
    </VCard>
  </VDialog>
</template>
