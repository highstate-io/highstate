<script setup lang="ts">
import type { BackendRoleInput } from "@highstate/backend/shared"
import {
  BackendRoleBindingsTable,
  BackendRoleDialog,
  DetailInfoCard,
  DetailPageLayout,
  IdTableCell,
  ObjectCodeBlock,
  RelatedDataPanel,
  SettingsPageHeader,
  TimeTableCell,
} from "#layers/core/app/features/settings"

const { params } = defineProps<{
  params: { roleId: string }
}>()

const roleStore = useBackendRoleSettingsStore()
const router = useRouter()
const roleId = params.roleId
const role = ref(await roleStore.get(roleId))
const editDialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const saving = ref(false)
const deleting = ref(false)
const bindingCount = ref(0)
const restrictionOptions = await roleStore.getRestrictionOptions()

definePageMeta({ name: "settings.backend-role-details" })

if (!role.value) {
  throw createError({ statusCode: 404, statusMessage: "Backend role not found" })
}

const detailItems = [
  { key: "id", label: "Role ID" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last updated" },
]

async function save(input: BackendRoleInput): Promise<void> {
  saving.value = true

  try {
    role.value = await roleStore.update(roleId, input)
    editDialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  deleting.value = true

  try {
    await roleStore.delete(roleId)
    await router.push({ name: "settings.backend-roles" })
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

    <DetailInfoCard title="Backend Role Details" :items="detailItems">
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
        <BackendRoleBindingsTable
          v-model:count="bindingCount"
          :role-id="role.id"
          :readonly="!!role.systemName"
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>

  <BackendRoleDialog
    v-if="role"
    v-model:visible="editDialogVisible"
    :role="role"
    :loading="saving"
    :restriction-options="restrictionOptions"
    @save="save"
  />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete backend role">
      <VCardText>This permanently deletes the role and all of its bindings.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn variant="text" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
