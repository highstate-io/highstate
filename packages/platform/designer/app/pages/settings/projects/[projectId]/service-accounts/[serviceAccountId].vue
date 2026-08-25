<script setup lang="ts">
import type { ServiceAccountInput } from "@highstate/backend/shared"
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  RelatedDataPanel,
  TimeTableCell,
  IdTableCell,
  ApiKeysTable,
  TerminalsTable,
  PagesTable,
  PanelsTable,
  SecretsTable,
  WorkersTable,
  ArtifactsTable,
  ProjectServiceAccountRoleBindingsTable,
  ProjectServiceAccountDialog,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"

const { projectStore } = useProjectStores()
const apiKeyStore = useProjectApiKeySettingsStore()
const artifactStore = useProjectArtifactSettingsStore()
const pageStore = useProjectPageSettingsStore()
const panelStore = useProjectPanelSettingsStore()
const secretStore = useProjectSecretSettingsStore()
const serviceAccountStore = useProjectServiceAccountSettingsStore()
const terminalStore = useProjectTerminalSettingsStore()
const workerStore = useProjectWorkerSettingsStore()

const { params } = defineProps<{
  params: {
    projectId: string
    serviceAccountId: string
  }
}>()

definePageMeta({
  name: "settings.service-account-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const serviceAccount = ref(await serviceAccountStore.get(params.serviceAccountId))

if (!serviceAccount.value) {
  throw createError({
    statusCode: 404,
    statusMessage: "Service Account not found",
  })
}

const router = useRouter()
const editDialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const saving = ref(false)
const deleting = ref(false)

async function save(input: ServiceAccountInput): Promise<void> {
  saving.value = true

  try {
    serviceAccount.value = await serviceAccountStore.update(params.serviceAccountId, input)
    editDialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  deleting.value = true

  try {
    await serviceAccountStore.delete(params.serviceAccountId)
    await router.push({
      name: "settings.service-accounts",
      params: { projectId: params.projectId },
    })
  } finally {
    deleting.value = false
  }
}

const detailItems = [
  { key: "serviceAccountId", label: "Service Account ID" },
  { key: "name", label: "Name" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]

// Load related data
const apiKeys = apiKeyStore.forServiceAccount(params.serviceAccountId)
const terminals = terminalStore.forServiceAccount(params.serviceAccountId)
const pages = pageStore.forServiceAccount(params.serviceAccountId)
const panels = panelStore.forServiceAccount(params.serviceAccountId)
const secrets = secretStore.forServiceAccount(params.serviceAccountId)
const workers = workerStore.forServiceAccount(params.serviceAccountId)
const artifacts = artifactStore.forServiceAccount(params.serviceAccountId)
const roleBindingCount = ref(0)

void apiKeys.load()
void terminals.load()
void pages.load()
void panels.load()
void secrets.load()
void workers.load()
void artifacts.load()
</script>

<template>
  <DetailPageLayout v-if="serviceAccount">
    <SettingsPageHeader
      :meta="serviceAccount.meta"
      fallback-icon="mdi-account-circle"
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

    <DetailInfoCard title="Service Account Details" :items="detailItems">
      <template #item.serviceAccountId>
        <IdTableCell :value="serviceAccount.id" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="serviceAccount.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="serviceAccount.updatedAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <RelatedDataPanel title="Roles" icon="mdi-shield-account" :count="roleBindingCount">
        <ProjectServiceAccountRoleBindingsTable
          v-model:count="roleBindingCount"
          :project-id="params.projectId"
          :service-account-id="serviceAccount.id"
          :readonly="!!serviceAccount.systemName"
        />
      </RelatedDataPanel>
      <!-- API Keys Panel -->
      <RelatedDataPanel title="API Keys" icon="mdi-key-variant" :count="apiKeys.data.value.total">
        <ApiKeysTable
          v-model:search="apiKeys.search.value"
          v-model:sort-by="apiKeys.sortBy.value"
          v-model:page="apiKeys.page.value"
          v-model:items-per-page="apiKeys.itemsPerPage.value"
          :project-id="params.projectId"
          :data="apiKeys.data.value"
          :loading="apiKeys.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Terminals Panel -->
      <RelatedDataPanel title="Terminals" icon="mdi-console" :count="terminals.data.value.total">
        <TerminalsTable
          v-model:search="terminals.search.value"
          v-model:sort-by="terminals.sortBy.value"
          v-model:page="terminals.page.value"
          v-model:items-per-page="terminals.itemsPerPage.value"
          :project-id="params.projectId"
          :data="terminals.data.value"
          :loading="terminals.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Pages Panel -->
      <RelatedDataPanel
        title="Pages"
        icon="mdi-file-document-outline"
        :count="pages.data.value.total"
      >
        <PagesTable
          v-model:search="pages.search.value"
          v-model:sort-by="pages.sortBy.value"
          v-model:page="pages.page.value"
          v-model:items-per-page="pages.itemsPerPage.value"
          :project-id="params.projectId"
          :data="pages.data.value"
          :loading="pages.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <RelatedDataPanel
        title="Panels"
        icon="mdi-view-dashboard-outline"
        :count="panels.data.value.total"
      >
        <PanelsTable
          v-model:search="panels.search.value"
          v-model:sort-by="panels.sortBy.value"
          v-model:page="panels.page.value"
          v-model:items-per-page="panels.itemsPerPage.value"
          :project-id="params.projectId"
          :data="panels.data.value"
          :loading="panels.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Secrets Panel -->
      <RelatedDataPanel title="Secrets" icon="mdi-key-variant" :count="secrets.data.value.total">
        <SecretsTable
          v-model:search="secrets.search.value"
          v-model:sort-by="secrets.sortBy.value"
          v-model:page="secrets.page.value"
          v-model:items-per-page="secrets.itemsPerPage.value"
          :project-id="params.projectId"
          :data="secrets.data.value"
          :loading="secrets.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Workers Panel -->
      <RelatedDataPanel
        title="Workers"
        icon="mdi-progress-wrench"
        :count="workers.data.value.total"
      >
        <WorkersTable
          v-model:search="workers.search.value"
          v-model:sort-by="workers.sortBy.value"
          v-model:page="workers.page.value"
          v-model:items-per-page="workers.itemsPerPage.value"
          :project-id="params.projectId"
          :data="workers.data.value"
          :loading="workers.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Artifacts Panel -->
      <RelatedDataPanel
        title="Artifacts"
        icon="mdi-package-variant"
        :count="artifacts.data.value.total"
      >
        <ArtifactsTable
          v-model:search="artifacts.search.value"
          v-model:sort-by="artifacts.sortBy.value"
          v-model:page="artifacts.page.value"
          v-model:items-per-page="artifacts.itemsPerPage.value"
          :project-id="params.projectId"
          :data="artifacts.data.value"
          :loading="artifacts.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>

  <ProjectServiceAccountDialog
    v-if="serviceAccount"
    v-model:visible="editDialogVisible"
    :service-account="serviceAccount"
    :loading="saving"
    @save="save"
  />

  <VDialog v-model="deleteDialogVisible" max-width="480">
    <VCard title="Delete project service account">
      <VCardText>
        This permanently deletes the service account and all of its role bindings.
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="deleting" @click="deleteDialogVisible = false">Cancel</VBtn>
        <VBtn color="error" :loading="deleting" @click="remove">Delete</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
