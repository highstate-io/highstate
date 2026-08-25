<script setup lang="ts">
import type { BackendApiKeyInput } from "@highstate/backend/shared"
import {
  ApiKeyTokenDialog,
  BackendApiKeyDialog,
  DetailInfoCard,
  DetailPageLayout,
  IdTableCell,
  ObjectCodeBlock,
  SettingsPageHeader,
  TimeTableCell,
} from "#layers/core/app/features/settings"

const { params } = defineProps<{ params: { apiKeyId: string } }>()
const apiKeyStore = useBackendApiKeySettingsStore()
const { $client } = useNuxtApp()
const router = useRouter()
const apiKey = ref(await apiKeyStore.get(params.apiKeyId))

if (!apiKey.value)
  throw createError({ statusCode: 404, statusMessage: "Backend API key not found" })

const [restrictionOptions, serviceAccounts] = await Promise.all([
  useBackendRoleSettingsStore().getRestrictionOptions(),
  apiKeyStore.getServiceAccountOptions(),
])

const editVisible = ref(false)
const deleteVisible = ref(false)
const rotateVisible = ref(false)
const tokenVisible = ref(false)
const token = ref("")
const saving = ref(false)
const deleting = ref(false)
const rotating = ref(false)
const detailItems = [
  { key: "id", label: "API key ID" },
  { key: "serviceAccount", label: "Service account" },
  { key: "expiresAt", label: "Expires" },
  { key: "lastUsedAt", label: "Last used" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last updated" },
]

definePageMeta({ name: "settings.backend-api-key-details" })

async function save(input: BackendApiKeyInput): Promise<void> {
  saving.value = true
  try {
    apiKey.value = await apiKeyStore.update(params.apiKeyId, input)
    editVisible.value = false
  } finally {
    saving.value = false
  }
}

async function rotate(): Promise<void> {
  rotating.value = true
  try {
    const result = await $client.apiKey.rotateBackend.mutate({ apiKeyId: params.apiKeyId })
    apiKey.value = result.apiKey
    rotateVisible.value = false
    token.value = result.token
    tokenVisible.value = true
  } finally {
    rotating.value = false
  }
}

async function remove(): Promise<void> {
  deleting.value = true
  try {
    await apiKeyStore.delete(params.apiKeyId)
    await router.push({ name: "settings.backend-api-keys" })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <DetailPageLayout v-if="apiKey">
    <SettingsPageHeader
      :meta="apiKey.meta"
      fallback-icon="mdi-key-variant"
      :title="apiKey.meta.title"
      :description="apiKey.meta.description"
    >
      <template #actions>
        <div class="d-flex ga-2">
          <VBtn variant="outlined" prepend-icon="mdi-pencil" @click="editVisible = true">Edit</VBtn>
          <VBtn variant="outlined" prepend-icon="mdi-refresh" @click="rotateVisible = true">
            Rotate
          </VBtn>
          <VBtn
            color="error"
            variant="outlined"
            prepend-icon="mdi-delete"
            @click="deleteVisible = true"
          >
            Delete
          </VBtn>
        </div>
      </template>
    </SettingsPageHeader>
    <DetailInfoCard title="Backend API Key Details" :items="detailItems">
      <template #item.id>
        <IdTableCell :value="apiKey.id" />
      </template>
      <template #item.serviceAccount>{{ apiKey.serviceAccountMeta.title }}</template>
      <template #item.expiresAt>
        <TimeTableCell v-if="apiKey.expiresAt" :value="apiKey.expiresAt" />
        <span v-else>Never</span>
      </template>
      <template #item.lastUsedAt>
        <TimeTableCell v-if="apiKey.lastUsedAt" :value="apiKey.lastUsedAt" />
        <span v-else>Never</span>
      </template>
      <template #item.createdAt>
        <TimeTableCell :value="apiKey.createdAt" />
      </template>
      <template #item.updatedAt>
        <TimeTableCell :value="apiKey.updatedAt" />
      </template>
    </DetailInfoCard>
    <VExpansionPanels :elevation="0">
      <ObjectCodeBlock title="Restriction Rules" :data="apiKey.restrictionRules" />
    </VExpansionPanels>
  </DetailPageLayout>
  <BackendApiKeyDialog
    v-if="apiKey"
    v-model:visible="editVisible"
    :api-key="apiKey"
    :service-accounts="serviceAccounts"
    :restriction-options="restrictionOptions"
    :loading="saving"
    @save="save"
  />
  <ApiKeyTokenDialog v-model:visible="tokenVisible" :token="token" />
  <VDialog v-model="rotateVisible" max-width="480">
    <VCard title="Rotate backend API key">
      <VCardText>The current token will stop working immediately.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="rotating" @click="rotateVisible = false">Cancel</VBtn>
        <VBtn color="warning" :loading="rotating" @click="rotate">Rotate</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
  <VDialog v-model="deleteVisible" max-width="480">
    <VCard title="Delete backend API key">
      <VCardText>This permanently revokes this API key.</VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
