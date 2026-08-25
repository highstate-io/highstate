<script setup lang="ts">
import type { BackendApiKeyInput, BackendApiKeyOutput } from "@highstate/backend/shared"
import {
  ApiKeyTokenDialog,
  BackendApiKeyDialog,
  BackendApiKeysTable,
  SettingsListPage,
} from "#layers/core/app/features/settings"

const apiKeyStore = useBackendApiKeySettingsStore()
const { $client } = useNuxtApp()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const rotateDialogVisible = ref(false)
const tokenDialogVisible = ref(false)
const apiKeyToDelete = ref<BackendApiKeyOutput | null>(null)
const apiKeyToRotate = ref<BackendApiKeyOutput | null>(null)
const token = ref("")
const saving = ref(false)
const deleting = ref(false)
const rotating = ref(false)
const [restrictionOptions, serviceAccounts] = await Promise.all([
  useBackendRoleSettingsStore().getRestrictionOptions(),
  apiKeyStore.getServiceAccountOptions(),
])

definePageMeta({
  name: "settings.backend-api-keys",
  tab: {
    label: "Backend API Keys",
    icon: "mdi-key-variant",
    order: 5,
    subpages: ["settings.backend-api-key-details"],
  },
})

async function save(input: BackendApiKeyInput): Promise<void> {
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

function confirmDelete(apiKey: BackendApiKeyOutput): void {
  apiKeyToDelete.value = apiKey
  deleteDialogVisible.value = true
}

function confirmRotate(apiKey: BackendApiKeyOutput): void {
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
    const result = await $client.apiKey.rotateBackend.mutate({ apiKeyId: apiKeyToRotate.value.id })
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
    title="Backend API Keys"
    icon="mdi-key-variant"
    description="Manage tokens that provide programmatic access to backend resources."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="dialogVisible = true">
        Create API key
      </VBtn>
    </template>
    <template #default="{ height }">
      <BackendApiKeysTable
        v-model:search="apiKeyStore.items.search"
        v-model:sort-by="apiKeyStore.items.sortBy"
        v-model:page="apiKeyStore.items.page"
        v-model:items-per-page="apiKeyStore.items.itemsPerPage"
        :data="apiKeyStore.items.data"
        :loading="apiKeyStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
        @rotate="confirmRotate"
      />
    </template>
  </SettingsListPage>
  <BackendApiKeyDialog
    v-model:visible="dialogVisible"
    :service-accounts="serviceAccounts"
    :restriction-options="restrictionOptions"
    :loading="saving"
    @save="save"
  />
  <ApiKeyTokenDialog v-model:visible="tokenDialogVisible" :token="token" />
  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete backend API key">
      <VCardText>This permanently revokes "{{ apiKeyToDelete?.meta.title }}".</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
  <VDialog v-model="rotateDialogVisible" max-width="480">
    <VCard title="Rotate backend API key">
      <VCardText>The current token will stop working immediately.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="rotating" @click="rotateDialogVisible = false">Cancel</VBtn>
        <VBtn color="warning" :loading="rotating" @click="rotate">Rotate</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
