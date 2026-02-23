<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  EntityReferencesTable,
  EntitySnapshotsTable,
  IdTableCell,
  ObjectCodeBlock,
  RelatedDataPanel,
  TimeTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { EntityRefChip, InstanceRefChip } from "#layers/core/app/features/shared"
import EntityExplorerCodeEditor from "#layers/core/app/features/entity-explorer/components/EntityExplorerCodeEditor.vue"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    snapshotId: string
  }
}>()

definePageMeta({
  name: "settings.entity-snapshot-details",
  key: route => `${String(route.params.projectId)}:${String(route.params.snapshotId)}`,
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const snapshotDetails = await settingsStore.getEntitySnapshotDetails(params.snapshotId)

if (!snapshotDetails) {
  throw createError({
    statusCode: 404,
    statusMessage: "Entity snapshot not found",
  })
}

const detailItems = [
  { key: "entityId", label: "Entity ID" },
  { key: "type", label: "Type" },
  { key: "snapshotId", label: "Snapshot ID" },
  { key: "snapshotCreatedAt", label: "Snapshot Created" },
  { key: "operationId", label: "Operation ID" },
  { key: "stateId", label: "State ID" },
]

const editorEntity = computed(() => {
  return {
    snapshotId: snapshotDetails.snapshot.id,
    entityId: snapshotDetails.entity.id,
    entityType: snapshotDetails.entity.type,
    entityIdentity: snapshotDetails.entity.identity,
    content: snapshotDetails.snapshot.content,
  }
})

const otherSnapshots = settingsStore.snapshotsForEntity(
  snapshotDetails.entity.id,
  params.snapshotId,
)

const outgoingReferences = settingsStore.outgoingReferencesForEntitySnapshot(params.snapshotId)
const incomingReferences = settingsStore.incomingReferencesForEntitySnapshot(params.snapshotId)

await otherSnapshots.load()
void outgoingReferences.load()
void incomingReferences.load()
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="snapshotDetails.snapshot.meta"
      fallback-icon="mdi-database"
      :title="snapshotDetails.snapshot.meta.title"
      :description="snapshotDetails.snapshot.meta.description"
    />

    <DetailInfoCard title="Entity Snapshot Details" :items="detailItems">
      <template #item.entityId>
        <IdTableCell :value="snapshotDetails.entity.id" />
      </template>

      <template #item.type>
        <div class="text-body-2">{{ snapshotDetails.entity.type }}</div>
      </template>

      <template #item.snapshotId>
        <IdTableCell :value="snapshotDetails.snapshot.id" />
      </template>

      <template #item.snapshotCreatedAt>
        <TimeTableCell :value="snapshotDetails.snapshot.createdAt" />
      </template>

      <template #item.operationId>
        <EntityRefChip
          :id="snapshotDetails.snapshot.operationId"
          fallback-icon="mdi-history"
          page-name="settings.operation-details"
          :page-params="{ operationId: snapshotDetails.snapshot.operationId }"
          :max-length="28"
        />
      </template>

      <template #item.stateId>
        <InstanceRefChip :item="{ stateId: snapshotDetails.snapshot.stateId }" />
      </template>
    </DetailInfoCard>

    <VExpansionPanels :elevation="0">
      <ObjectCodeBlock
        title="Identity"
        :data="snapshotDetails.entity.identity"
        language="yaml"
        icon="mdi-identifier"
      />

      <VExpansionPanel color="#2d2d2d" bg-color="#1e1e1e">
        <template #title>
          <div class="d-flex align-center">
            <VIcon class="mr-2">mdi-code-json</VIcon>
            Content
          </div>
        </template>

        <template #text>
          <div class="entity-snapshot-editor">
            <EntityExplorerCodeEditor
              :entity="editorEntity"
              :project-id="params.projectId"
              height="400px"
            />
          </div>
        </template>
      </VExpansionPanel>

      <RelatedDataPanel
        title="Other snapshots"
        icon="mdi-history"
        :count="otherSnapshots.data.value.total"
      >
        <EntitySnapshotsTable
          v-model:search="otherSnapshots.search.value"
          v-model:sort-by="otherSnapshots.sortBy.value"
          v-model:page="otherSnapshots.page.value"
          v-model:items-per-page="otherSnapshots.itemsPerPage.value"
          :project-id="params.projectId"
          :data="otherSnapshots.data.value"
          :loading="otherSnapshots.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <RelatedDataPanel
        title="References to other entities"
        icon="mdi-call-made"
        :count="outgoingReferences.data.value.total"
      >
        <EntityReferencesTable
          v-model:search="outgoingReferences.search.value"
          v-model:sort-by="outgoingReferences.sortBy.value"
          v-model:page="outgoingReferences.page.value"
          v-model:items-per-page="outgoingReferences.itemsPerPage.value"
          :project-id="params.projectId"
          :data="outgoingReferences.data.value"
          :loading="outgoingReferences.isLoading.value"
          direction="outgoing"
          hide-header
        />
      </RelatedDataPanel>

      <RelatedDataPanel
        title="Entities referencing this entity"
        icon="mdi-call-received"
        :count="incomingReferences.data.value.total"
      >
        <EntityReferencesTable
          v-model:search="incomingReferences.search.value"
          v-model:sort-by="incomingReferences.sortBy.value"
          v-model:page="incomingReferences.page.value"
          v-model:items-per-page="incomingReferences.itemsPerPage.value"
          :project-id="params.projectId"
          :data="incomingReferences.data.value"
          :loading="incomingReferences.isLoading.value"
          direction="incoming"
          hide-header
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>
</template>

<style scoped>
.entity-snapshot-editor {
  width: 100%;
  border-radius: 0;
  overflow: hidden;
}
</style>
