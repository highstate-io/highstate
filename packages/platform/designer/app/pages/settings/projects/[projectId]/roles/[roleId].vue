<script setup lang="ts">
import type { ProjectRoleInput } from "@highstate/backend/shared"
import {
  DetailInfoCard,
  DetailPageLayout,
  IdTableCell,
  ObjectCodeBlock,
  ProjectRoleBindingsTable,
  ProjectRoleDialog,
  RelatedDataPanel,
  SettingsPageHeader,
  TimeTableCell,
} from "#layers/core/app/features/settings"
const { params } = defineProps<{ params: { projectId: string; roleId: string } }>()
const roleStore = useProjectRoleSettingsStore()
const router = useRouter()
const role = ref(await roleStore.get(params.roleId))
if (!role.value) throw createError({ statusCode: 404, statusMessage: "Project role not found" })
const editDialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const saving = ref(false)
const deleting = ref(false)
const bindingCount = ref(0)
const restrictionOptions = await roleStore.getRestrictionOptions()
const detailItems = [
  { key: "id", label: "Role ID" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last updated" },
]
definePageMeta({ name: "settings.project-role-details" })
async function save(input: ProjectRoleInput): Promise<void> {
  saving.value = true
  try {
    role.value = await roleStore.update(params.roleId, input)
    editDialogVisible.value = false
  } finally {
    saving.value = false
  }
}
async function remove(): Promise<void> {
  deleting.value = true
  try {
    await roleStore.delete(params.roleId)
    await router.push({ name: "settings.project-roles", params: { projectId: params.projectId } })
  } finally {
    deleting.value = false
  }
}
</script>
<template>
  <DetailPageLayout v-if="role">
    <SettingsPageHeader
      :meta="role.meta"
      fallback-icon="mdi-shield-account"
      :title="role.meta.title"
      :description="role.meta.description"
    >
      <template v-if="!role.systemName" #actions>
        <div class="d-flex ga-2">
          <VBtn variant="outlined" prepend-icon="mdi-pencil" @click="editDialogVisible = true">
            Edit
          </VBtn>
          <VBtn
            color="error"
            variant="outlined"
            prepend-icon="mdi-delete"
            @click="deleteDialogVisible = true"
          >
            Delete
          </VBtn>
        </div>
      </template>
    </SettingsPageHeader>
    <VAlert v-if="role.systemName" type="info" variant="tonal" style="flex: none">
      This system-managed role is read-only.
    </VAlert>
    <DetailInfoCard title="Project Role Details" :items="detailItems">
      <template #item.id>
        <IdTableCell :value="role.id" />
      </template>
      <template #item.createdAt>
        <TimeTableCell :value="role.createdAt" />
      </template>
      <template #item.updatedAt>
        <TimeTableCell :value="role.updatedAt" />
      </template>
    </DetailInfoCard>
    <VExpansionPanels :elevation="0">
      <ObjectCodeBlock title="Rules" :data="role.rules" icon="mdi-code-braces" />
      <RelatedDataPanel title="Service Accounts" icon="mdi-account-circle" :count="bindingCount">
        <ProjectRoleBindingsTable
          v-model:count="bindingCount"
          :project-id="params.projectId"
          :role-id="role.id"
          :readonly="!!role.systemName"
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>
  <ProjectRoleDialog
    v-if="role"
    v-model:visible="editDialogVisible"
    :role="role"
    :loading="saving"
    :restriction-options="restrictionOptions"
    @save="save"
  />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete project role">
      <VCardText>This permanently deletes the role and all of its bindings.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
