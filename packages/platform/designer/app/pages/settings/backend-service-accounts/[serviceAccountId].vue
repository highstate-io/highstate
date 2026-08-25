<script setup lang="ts">
import type { BackendServiceAccountInput } from "@highstate/backend/shared"
import {
  BackendProjectBindingsTable,
  BackendServiceAccountDialog,
  BackendServiceAccountRoleBindingsTable,
  DetailInfoCard,
  DetailPageLayout,
  IdTableCell,
  RelatedDataPanel,
  SettingsPageHeader,
  TimeTableCell,
} from "#layers/core/app/features/settings"

const { params } = defineProps<{
  params: { serviceAccountId: string }
}>()

const serviceAccountStore = useBackendServiceAccountSettingsStore()
const router = useRouter()
const serviceAccountId = params.serviceAccountId
const serviceAccount = ref(await serviceAccountStore.get(serviceAccountId))
const editDialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const saving = ref(false)
const deleting = ref(false)
const roleBindingCount = ref(0)
const projectBindingCount = ref(0)

definePageMeta({ name: "settings.backend-service-account-details" })

if (!serviceAccount.value) {
  throw createError({ statusCode: 404, statusMessage: "Backend service account not found" })
}

const detailItems = [
  { key: "id", label: "Service account ID" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last updated" },
]

async function save(input: BackendServiceAccountInput): Promise<void> {
  saving.value = true

  try {
    serviceAccount.value = await serviceAccountStore.update(serviceAccountId, input)
    editDialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  deleting.value = true

  try {
    await serviceAccountStore.delete(serviceAccountId)
    await router.push({ name: "settings.backend-service-accounts" })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <DetailPageLayout v-if="serviceAccount">
    <SettingsPageHeader
      :meta="serviceAccount.meta"
      fallback-icon="mdi-account-key"
      :title="serviceAccount.meta.title"
      :description="serviceAccount.meta.description"
    >
      <template v-if="!serviceAccount.systemName" #actions>
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

    <VAlert v-if="serviceAccount.systemName" type="info" variant="tonal" style="flex: none">
      This system-managed service account is read-only.
    </VAlert>

    <DetailInfoCard title="Backend Service Account Details" :items="detailItems">
      <template #item.id>
        <IdTableCell :value="serviceAccount.id" />
      </template>
      <template #item.createdAt>
        <TimeTableCell :value="serviceAccount.createdAt" />
      </template>
      <template #item.updatedAt>
        <TimeTableCell :value="serviceAccount.updatedAt" />
      </template>
    </DetailInfoCard>

    <VExpansionPanels :elevation="0">
      <RelatedDataPanel title="Roles" icon="mdi-shield-account" :count="roleBindingCount">
        <BackendServiceAccountRoleBindingsTable
          v-model:count="roleBindingCount"
          :service-account-id="serviceAccount.id"
          :readonly="!!serviceAccount.systemName"
        />
      </RelatedDataPanel>
      <RelatedDataPanel title="Projects" icon="mdi-folder-key" :count="projectBindingCount">
        <BackendProjectBindingsTable
          v-model:count="projectBindingCount"
          :service-account-id="serviceAccount.id"
          :readonly="!!serviceAccount.systemName"
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>

  <BackendServiceAccountDialog
    v-if="serviceAccount"
    v-model:visible="editDialogVisible"
    :service-account="serviceAccount"
    :loading="saving"
    @save="save"
  />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete backend service account">
      <VCardText>
        This permanently deletes the service account and all of its role and project bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn variant="text" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
