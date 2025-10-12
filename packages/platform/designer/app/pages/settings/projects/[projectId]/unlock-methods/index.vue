<script setup lang="ts">
import type { UnlockMethodOutput } from "@highstate/backend/shared"
import { SettingsListPage, UnlockMethodsTable } from "#layers/core/app/features/settings"
import {
  CreateUnlockMethodDialog,
  DeleteUnlockMethodDialog,
} from "#layers/core/app/features/unlock-methods"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.unlockMethods.load()

definePageMeta({
  name: "settings.unlock-methods",
  tab: {
    label: "Unlock Methods",
    icon: "mdi-lock-open-outline",
    order: 17,
    subpages: ["settings.unlock-method-details"],
  },
})

const showCreateDialog = ref(false)
const showDeleteDialog = ref(false)
const unlockMethodToDelete = ref<UnlockMethodOutput | null>(null)
const deleteLoading = ref(false)

const handleDeleteUnlockMethod = (unlockMethod: UnlockMethodOutput) => {
  unlockMethodToDelete.value = unlockMethod
  showDeleteDialog.value = true
}

const handleConfirmDelete = async (unlockMethod: UnlockMethodOutput) => {
  deleteLoading.value = true

  try {
    await settingsStore.removeUnlockMethod(unlockMethod.id)
    showDeleteDialog.value = false
    unlockMethodToDelete.value = null
  } catch (error) {
    console.error("Failed to delete unlock method:", error)
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <SettingsListPage
    title="Unlock Methods"
    icon="mdi-lock-open-outline"
    description="Manage the methods used to unlock and access this project's encrypted data."
  >
    <template #actions>
      <VBtn color="primary" prepend-icon="mdi-plus" @click="showCreateDialog = true">
        Add Unlock Method
      </VBtn>
    </template>

    <template #default="{ height }">
      <UnlockMethodsTable
        v-model:search="settingsStore.unlockMethods.search"
        v-model:sort-by="settingsStore.unlockMethods.sortBy"
        v-model:page="settingsStore.unlockMethods.page"
        v-model:items-per-page="settingsStore.unlockMethods.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.unlockMethods.data"
        :loading="settingsStore.unlockMethods.isLoading"
        :height="height"
        @delete="handleDeleteUnlockMethod"
      />
    </template>
  </SettingsListPage>

  <!-- Dialogs -->
  <CreateUnlockMethodDialog v-model:visible="showCreateDialog" />
  <DeleteUnlockMethodDialog
    v-model:visible="showDeleteDialog"
    :unlock-method="unlockMethodToDelete"
    @confirm="handleConfirmDelete"
  />
</template>
