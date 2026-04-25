<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  EntityReferencesTable,
  EntitySnapshotsTable,
  getSettingsEntityDisplayFromContent,
  IdTableCell,
  ObjectCodeBlock,
  RelatedDataPanel,
  TimeTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { EntityRefChip, InstanceRefChip } from "#layers/core/app/features/shared"
import EntityExplorerCodeEditor from "#layers/core/app/features/entity-explorer/components/EntityExplorerCodeEditor.vue"

const { settingsStore, libraryStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    snapshotId: string
  }
}>()

const route = useRoute()
const activeSnapshotId = computed(() => {
  return String(route.params.snapshotId ?? params.snapshotId)
})

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

const snapshotDetails =
  shallowRef<Awaited<ReturnType<typeof settingsStore.getEntitySnapshotDetails>>>()

const otherSnapshots = shallowRef(settingsStore.snapshotsForEntity("", activeSnapshotId.value))
const outgoingReferences = shallowRef(
  settingsStore.outgoingReferencesForEntitySnapshot(activeSnapshotId.value),
)
const incomingReferences = shallowRef(
  settingsStore.incomingReferencesForEntitySnapshot(activeSnapshotId.value),
)

const loadSnapshotState = async (snapshotId: string) => {
  const details = await settingsStore.getEntitySnapshotDetails(snapshotId)
  if (!details) {
    showError(
      createError({
        statusCode: 404,
        statusMessage: "Entity snapshot not found",
      }),
    )
    return
  }

  snapshotDetails.value = details

  otherSnapshots.value = settingsStore.snapshotsForEntity(details.entity.id, snapshotId)
  outgoingReferences.value = settingsStore.outgoingReferencesForEntitySnapshot(snapshotId)
  incomingReferences.value = settingsStore.incomingReferencesForEntitySnapshot(snapshotId)

  await otherSnapshots.value.load()
  void outgoingReferences.value.load()
  void incomingReferences.value.load()
}

await loadSnapshotState(activeSnapshotId.value)

watch(activeSnapshotId, async snapshotId => {
  await loadSnapshotState(snapshotId)
})

const detailItems = [
  { key: "entityId", label: "Entity ID" },
  { key: "type", label: "Type" },
  { key: "snapshotId", label: "Snapshot ID" },
  { key: "snapshotCreatedAt", label: "Snapshot Created" },
  { key: "operationId", label: "Operation ID" },
  { key: "stateId", label: "State ID" },
]

const editorEntity = computed(() => {
  const details = snapshotDetails.value
  if (!details) {
    return undefined
  }

  return {
    snapshotId: details.snapshot.id,
    entityId: details.entity.id,
    entityType: details.entity.type,
    entityIdentity: details.entity.identity,
    content: details.snapshot.content,
  }
})

const snapshotDisplay = computed(() => {
  const details = snapshotDetails.value
  if (!details) {
    return {
      title: "Unknown",
      subtitle: undefined,
      metaForIcon: undefined,
    }
  }

  return getSettingsEntityDisplayFromContent({
    entities: libraryStore.library?.entities ?? {},
    entityType: details.entity.type,
    content: details.snapshot.content,
  })
})

const headerMeta = computed(() => {
  const meta = snapshotDisplay.value.metaForIcon

  if (!meta?.title) {
    return undefined
  }

  return {
    title: meta.title,
    ...(meta.icon ? { icon: meta.icon } : {}),
    ...(meta.iconColor ? { iconColor: meta.iconColor } : {}),
  }
})
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="headerMeta"
      fallback-icon="mdi-database"
      :title="snapshotDisplay.title"
      :description="snapshotDisplay.subtitle"
    />

    <template v-if="snapshotDetails">
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
                v-if="editorEntity"
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
            :fallback-icon-meta="snapshotDisplay.metaForIcon"
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
    </template>
  </DetailPageLayout>
</template>

<style scoped>
.entity-snapshot-editor {
  width: 100%;
  border-radius: 0;
  overflow: hidden;
}
</style>
