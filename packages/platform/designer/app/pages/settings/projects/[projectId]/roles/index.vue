<script setup lang="ts">
import type { ProjectRoleInput, ProjectRoleOutput } from "@highstate/backend/shared"
import {
  ProjectRoleDialog,
  ProjectRolesTable,
  SettingsListPage,
} from "#layers/core/app/features/settings"

const { params } = defineProps<{ params: { projectId: string } }>()
const roleStore = useProjectRoleSettingsStore()
const router = useRouter()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const roleToDelete = ref<ProjectRoleOutput | null>(null)
const saving = ref(false)
const deleting = ref(false)
const restrictionOptions = await roleStore.getRestrictionOptions()
definePageMeta({
  name: "settings.project-roles",
  tab: {
    label: "Roles",
    icon: "mdi-shield-account",
    order: 18,
    subpages: ["settings.project-role-details"],
  },
})
async function save(input: ProjectRoleInput): Promise<void> {
  saving.value = true
  try {
    const role = await roleStore.create(input)
    dialogVisible.value = false
    await router.push({
      name: "settings.project-role-details",
      params: { projectId: params.projectId, roleId: role.id },
    })
  } finally {
    saving.value = false
  }
}
function confirmDelete(role: ProjectRoleOutput): void {
  roleToDelete.value = role
  deleteDialogVisible.value = true
}
async function remove(): Promise<void> {
  if (!roleToDelete.value) return
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
    title="Roles"
    icon="mdi-shield-account"
    description="Manage roles that grant permissions within this project."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="dialogVisible = true">Create role</VBtn>
    </template>
    <template #default="{ height }">
      <ProjectRolesTable
        v-model:search="roleStore.items.search"
        v-model:sort-by="roleStore.items.sortBy"
        v-model:page="roleStore.items.page"
        v-model:items-per-page="roleStore.items.itemsPerPage"
        :project-id="params.projectId"
        :data="roleStore.items.data"
        :loading="roleStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
      />
    </template>
  </SettingsListPage>
  <ProjectRoleDialog
    v-model:visible="dialogVisible"
    :loading="saving"
    :restriction-options="restrictionOptions"
    @save="save"
  />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete project role">
      <VCardText>
        This permanently deletes "{{ roleToDelete?.meta.title }}" and all of its bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
