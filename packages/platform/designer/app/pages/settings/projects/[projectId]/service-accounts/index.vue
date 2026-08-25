<script setup lang="ts">
import type { ServiceAccountInput, ServiceAccountOutput } from "@highstate/backend/shared"
import {
  ProjectServiceAccountDialog,
  SettingsListPage,
  ServiceAccountsTable,
} from "#layers/core/app/features/settings"

const { projectStore } = useProjectStores()
const serviceAccountStore = useProjectServiceAccountSettingsStore()
const router = useRouter()
const dialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const serviceAccountToDelete = ref<ServiceAccountOutput | null>(null)
const saving = ref(false)
const deleting = ref(false)

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void serviceAccountStore.items.load()

async function save(input: ServiceAccountInput): Promise<void> {
  saving.value = true

  try {
    const serviceAccount = await serviceAccountStore.create(input)
    dialogVisible.value = false
    await router.push({
      name: "settings.service-account-details",
      params: { projectId: projectStore.projectId, serviceAccountId: serviceAccount.id },
    })
  } finally {
    saving.value = false
  }
}

function confirmDelete(serviceAccount: ServiceAccountOutput): void {
  serviceAccountToDelete.value = serviceAccount
  deleteDialogVisible.value = true
}

async function remove(): Promise<void> {
  if (!serviceAccountToDelete.value) return
  deleting.value = true

  try {
    await serviceAccountStore.delete(serviceAccountToDelete.value.id)
    deleteDialogVisible.value = false
    serviceAccountToDelete.value = null
  } finally {
    deleting.value = false
  }
}

definePageMeta({
  name: "settings.service-accounts",
  tab: {
    label: "Service Accounts",
    icon: "mdi-account-circle",
    order: 17,
    subpages: ["settings.service-account-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Service Accounts"
    icon="mdi-account-circle"
    description="Manage the service accounts that provide identities for automated processes and applications."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="dialogVisible = true">
        Create service account
      </VBtn>
    </template>
    <template #default="{ height }">
      <ServiceAccountsTable
        v-model:search="serviceAccountStore.items.search"
        v-model:sort-by="serviceAccountStore.items.sortBy"
        v-model:page="serviceAccountStore.items.page"
        v-model:items-per-page="serviceAccountStore.items.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="serviceAccountStore.items.data"
        :loading="serviceAccountStore.items.isLoading"
        :height="height"
        @delete="confirmDelete"
      />
    </template>
  </SettingsListPage>

  <ProjectServiceAccountDialog v-model:visible="dialogVisible" :loading="saving" @save="save" />

  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete project service account">
      <VCardText>
        This permanently deletes "{{ serviceAccountToDelete?.meta.title }}" and all of its role
        bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
