<script setup lang="ts">
import type { ApiKeyInput, ApiKeyOutput } from "@highstate/backend/shared"
import {
  ApiKeyTokenDialog,
  ApiKeysTable,
  ProjectApiKeyDialog,
  SettingsListPage,
} from "#layers/core/app/features/settings"

const { params } = defineProps<{ params: { projectId: string } }>()
const { projectStore } = useProjectStores()
const apiKeyStore = useProjectApiKeySettingsStore()
const { $client } = useNuxtApp()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const rotateDialogVisible = ref(false)
const tokenDialogVisible = ref(false)
const apiKeyToDelete = ref<ApiKeyOutput | null>(null)
const apiKeyToRotate = ref<ApiKeyOutput | null>(null)
const token = ref("")
const saving = ref(false)
const deleting = ref(false)
const rotating = ref(false)

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}
const [restrictionOptions, serviceAccounts] = await Promise.all([
  useProjectRoleSettingsStore().getRestrictionOptions(),
  apiKeyStore.getServiceAccountOptions(),
])

definePageMeta({
  name: "settings.api-keys",
  tab: {
    label: "API Keys",
    icon: "mdi-key-variant",
    order: 18,
    subpages: ["settings.api-key-details"],
  },
})

async function save(input: ApiKeyInput): Promise<void> {
  saving.value = true
  try {
    const result = await apiKeyStore.create(input)
    dialogVisible.value = false
    token.value = result.token
    tokenDialogVisible.value = true
  } finally {
    saving.value = false
  }
}

function confirmDelete(apiKey: ApiKeyOutput): void {
  apiKeyToDelete.value = apiKey
  deleteDialogVisible.value = true
}

function confirmRotate(apiKey: ApiKeyOutput): void {
  apiKeyToRotate.value = apiKey
  rotateDialogVisible.value = true
}

async function remove(): Promise<void> {
  if (!apiKeyToDelete.value) return
  deleting.value = true
  try {
    await apiKeyStore.delete(apiKeyToDelete.value.id)
    deleteDialogVisible.value = false
    apiKeyToDelete.value = null
  } finally {
    deleting.value = false
  }
}

async function rotate(): Promise<void> {
  if (!apiKeyToRotate.value) return
  rotating.value = true
  try {
    const result = await $client.apiKey.rotateProject.mutate({
      projectId: params.projectId,
      apiKeyId: apiKeyToRotate.value.id,
    })
    await apiKeyStore.items.load()
    rotateDialogVisible.value = false
    token.value = result.token
    tokenDialogVisible.value = true
    apiKeyToRotate.value = null
  } finally {
    rotating.value = false
  }
}

void apiKeyStore.items.load()
</script>

<template>
  <SettingsListPage
    title="API Keys"
    icon="mdi-key-variant"
    description="Manage tokens that provide programmatic access to project resources."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="dialogVisible = true">
        Create API key
      </VBtn>
    </template>
    <template #default="{ height }">
      <ApiKeysTable
        v-model:search="apiKeyStore.items.search"
        v-model:sort-by="apiKeyStore.items.sortBy"
        v-model:page="apiKeyStore.items.page"
        v-model:items-per-page="apiKeyStore.items.itemsPerPage"
        :project-id="params.projectId"
        :data="apiKeyStore.items.data"
        :loading="apiKeyStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
        @rotate="confirmRotate"
      />
    </template>
  </SettingsListPage>
  <ProjectApiKeyDialog
    v-model:visible="dialogVisible"
    :service-accounts="serviceAccounts"
    :restriction-options="restrictionOptions"
    :loading="saving"
    @save="save"
  />
  <ApiKeyTokenDialog v-model:visible="tokenDialogVisible" :token="token" />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete API key">
      <VCardText>This permanently revokes "{{ apiKeyToDelete?.meta.title }}".</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
  <VDialog v-model="rotateDialogVisible" max-width="480">
    <VCard title="Rotate API key">
      <VCardText>The current token will stop working immediately.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="rotating" @click="rotateDialogVisible = false">Cancel</VBtn>
        <VBtn color="warning" :loading="rotating" @click="rotate">Rotate</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
