<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  ObjectCodeBlock,
  RelatedDataPanel,
  TerminalSessionsTable,
  TimeTableCell,
  IdTableCell,
  ArtifactsTable,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { OwnerRefChip, terminalStatusMap } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    terminalId: string
  }
}>()

definePageMeta({
  name: "settings.terminal-details",
})

// Initialize project store
if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

// load terminal details
const terminal = await settingsStore.getTerminalDetails(params.terminalId)

if (!terminal) {
  throw createError({
    statusCode: 404,
    statusMessage: "Terminal not found",
  })
}

// load terminal sessions data
const terminalSessions = settingsStore.sessionsForTerminal(params.terminalId)
const artifacts = settingsStore.artifactsForTerminal(params.terminalId)
await terminalSessions.load()
await artifacts.load()

// Detail info items configuration
const detailItems = [
  { key: "terminalId", label: "Terminal ID" },
  { key: "name", label: "Name" },
  { key: "serviceAccount", label: "Owner" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]

// Helper functions

const openTerminalSession = (sessionId: string) => {
  navigateTo({ name: "terminal-session", params: { projectId: params.projectId, sessionId } })
}
</script>

<template>
  <DetailPageLayout>
    <!-- Header Section -->
    <SettingsPageHeader
      :meta="terminal.meta"
      fallback-icon="mdi-console"
      :title="terminal.meta.title || terminal.name || 'Unnamed Terminal'"
      :status="terminal.status"
      :status-map="terminalStatusMap"
      :description="terminal.meta.description"
    />

    <!-- Terminal Details Card -->
    <DetailInfoCard title="Terminal Details" :items="detailItems">
      <template #item.terminalId>
        <IdTableCell :value="terminal.id" />
      </template>

      <template #item.name>
        <div class="text-body-2">{{ terminal.name || "N/A" }}</div>
      </template>

      <template #item.serviceAccount>
        <OwnerRefChip :item="terminal" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="terminal.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="terminal.updatedAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <!-- Specification Panel -->
      <ObjectCodeBlock title="Spec" :data="terminal.spec" />

      <!-- Terminal Sessions Panel -->
      <RelatedDataPanel
        title="Sessions"
        icon="mdi-console"
        :count="terminalSessions.data.value.total"
      >
        <TerminalSessionsTable
          v-model:search="terminalSessions.search.value"
          v-model:sort-by="terminalSessions.sortBy.value"
          v-model:page="terminalSessions.page.value"
          v-model:items-per-page="terminalSessions.itemsPerPage.value"
          :project-id="params.projectId"
          :data="terminalSessions.data.value"
          :loading="terminalSessions.isLoading.value"
          :hide-header="true"
          @open-session="openTerminalSession"
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
