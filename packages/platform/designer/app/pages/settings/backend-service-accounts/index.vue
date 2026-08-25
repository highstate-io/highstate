<script setup lang="ts">
import type {
  BackendServiceAccountInput,
  BackendServiceAccountOutput,
} from "@highstate/backend/shared"
import {
  BackendServiceAccountDialog,
  BackendServiceAccountsTable,
  SettingsListPage,
} from "#layers/core/app/features/settings"

const serviceAccountStore = useBackendServiceAccountSettingsStore()
const router = useRouter()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const serviceAccountToDelete = ref<BackendServiceAccountOutput | null>(null)
const saving = ref(false)
const deleting = ref(false)

definePageMeta({
  name: "settings.backend-service-accounts",
  tab: {
    label: "Backend Service Accounts",
    icon: "mdi-account-key",
    order: 4,
    subpages: ["settings.backend-service-account-details"],
  },
})

async function save(input: BackendServiceAccountInput): Promise<void> {
  saving.value = true

  try {
    const serviceAccount = await serviceAccountStore.create(input)
    dialogVisible.value = false
    await router.push({
      name: "settings.backend-service-account-details",
      params: { serviceAccountId: serviceAccount.id },
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(serviceAccount: BackendServiceAccountOutput): void {
  serviceAccountToDelete.value = serviceAccount
  deleteDialogVisible.value = true
}

async function remove(): Promise<void> {
  if (!serviceAccountToDelete.value) {
    return
  }

  deleting.value = true

  try {
    await serviceAccountStore.delete(serviceAccountToDelete.value.id)
    deleteDialogVisible.value = false
    serviceAccountToDelete.value = null
  } finally {
    deleting.value = false
  }
}

void serviceAccountStore.items.load()
</script>

<template>
  <SettingsListPage
    title="Backend Service Accounts"
    icon="mdi-account-key"
    description="Manage non-human identities that access backend and project resources."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="dialogVisible = true">
        Create service account
      </VBtn>
    </template>
    <template #default="{ height }">
      <BackendServiceAccountsTable
        v-model:search="serviceAccountStore.items.search"
        v-model:sort-by="serviceAccountStore.items.sortBy"
        v-model:page="serviceAccountStore.items.page"
        v-model:items-per-page="serviceAccountStore.items.itemsPerPage"
        :data="serviceAccountStore.items.data"
        :loading="serviceAccountStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
      />
    </template>
  </SettingsListPage>

  <BackendServiceAccountDialog v-model:visible="dialogVisible" :loading="saving" @save="save" />

  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete backend service account">
      <VCardText>
        This permanently deletes "{{ serviceAccountToDelete?.meta.title }}" and all of its role and
        project bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
