<script setup lang="ts">
import {
  DetailPageLayout,
  DetailInfoCard,
  RelatedDataPanel,
  IdTableCell,
  ObjectCodeBlock,
  TerminalsTable,
  SecretsTable,
  PagesTable,
  TriggersTable,
  ArtifactsTable,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { PreviewCanvas } from "#layers/core/app/features/canvas"

const { settingsStore, instancesStore, stateStore, libraryStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    stateId: string
  }
}>()

definePageMeta({
  name: "settings.instance-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

// wait for instances and states store to be ready
await until(() => instancesStore.initializationPhase !== "loading").toBe(true)
await until(() => stateStore.statesLoaded).toBe(true)

const instanceId = stateStore.getStateByStateId(params.stateId)?.instanceId
if (!instanceId) {
  throw createError({
    statusCode: 404,
    statusMessage: "Instance not found for the given state ID",
  })
}

const instance = instancesStore.instances.get(instanceId)

if (!instance) {
  throw createError({
    statusCode: 404,
    statusMessage: "Instance not found",
  })
}

// get component metadata from library
const component = libraryStore.library.components[instance.type]
const componentMeta = component?.meta

const detailItems = [
  { key: "instanceId", label: "Instance ID" },
  { key: "stateId", label: "State ID" },
  { key: "type", label: "Component Type" },
  { key: "kind", label: "Kind" },
]

// prepare data for canvas preview
const components = libraryStore.library.components
const entities = libraryStore.library.entities

// load related data
const terminals = settingsStore.terminalsForState(params.stateId)
const secrets = settingsStore.secretsForState(params.stateId)
const pages = settingsStore.pagesForState(params.stateId)
const triggers = settingsStore.triggersForState(params.stateId)
const artifacts = settingsStore.artifactsForState(params.stateId)

void terminals.load()
void secrets.load()
void pages.load()
void triggers.load()
void artifacts.load()

// headers removed - now handled by table components
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="componentMeta"
      fallback-icon="mdi-cube-outline"
      :title="component.meta.title"
      :description="instance.name"
    >
      <template #actions>
        <VBtn
          variant="outlined"
          prepend-icon="mdi-vector-square"
          @click="
            () => {
              // Simply navigate to the canvas page
              navigateTo({
                name: 'project',
                params: { projectId: params.projectId },
              })
            }
          "
        >
          View in Canvas
        </VBtn>
      </template>
    </SettingsPageHeader>

    <!-- Row container for details and preview -->
    <div class="d-flex ga-6" style="min-height: 400px">
      <!-- Instance Details Card -->
      <DetailInfoCard title="Instance Details" :items="detailItems" style="flex: 1">
        <template #item.instanceId>
          <IdTableCell :truncate="false" :value="instance.id" />
        </template>

        <template #item.stateId>
          <IdTableCell :truncate="false" :value="params.stateId" />
        </template>

        <template #item.type>
          <IdTableCell :truncate="false" :value="instance.type" />
        </template>

        <template #item.kind>
          <div class="text-body-2 text-capitalize">{{ instance.kind }}</div>
        </template>
      </DetailInfoCard>

      <!-- Canvas Preview Card -->
      <VCard style="flex: 1; border: solid 2px #2d2d2d" :elevation="0">
        <VCardTitle class="d-flex align-center">Preview</VCardTitle>
        <VCardText class="pa-0" style="height: 350px">
          <PreviewCanvas
            :instances="[instance]"
            :hubs="[]"
            :components="components"
            :entities="entities"
            :auto-position="false"
          />
        </VCardText>
      </VCard>
    </div>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <!-- Instance Model Display -->
      <ObjectCodeBlock title="Instance Model" :data="instance" />

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

      <!-- Triggers Panel -->
      <RelatedDataPanel
        title="Triggers"
        icon="mdi-lightning-bolt"
        :count="triggers.data.value.total"
      >
        <TriggersTable
          v-model:search="triggers.search.value"
          v-model:sort-by="triggers.sortBy.value"
          v-model:page="triggers.page.value"
          v-model:items-per-page="triggers.itemsPerPage.value"
          :project-id="params.projectId"
          :data="triggers.data.value"
          :loading="triggers.isLoading.value"
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
</template>
