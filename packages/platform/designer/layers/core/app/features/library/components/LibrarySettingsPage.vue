<script setup lang="ts">
import type { SelectedLibraryPackage } from "@highstate/contract"
import { z } from "zod"
import { SettingsPageHeader, TableItemAction } from "#layers/core/app/features/settings"
import LibraryPackageDialog from "./LibraryPackageDialog.vue"

const { projectId } = defineProps<{ projectId: string }>()
const store = (await useProjectLibraryStore.async(projectId)).library
const visible = ref(false)
const selected = shallowRef<SelectedLibraryPackage | null>(null)
const deleteTarget = shallowRef<SelectedLibraryPackage | null>(null)
const deleteVisible = ref(false)
const savingOverlay = ref(false)

const headers = [
  { title: "Package", key: "packageName" },
  { title: "Version", key: "version" },
  { title: "Actions", key: "actions", sortable: false, align: "center" as const, width: 104 },
]

const packages = computed(() => store.projectLibrary?.selectedPackages ?? [])

const imageSchema = z.object({
  status: z.string(),
  error: z.string().nullish(),
  progress: z.object({ message: z.string().optional(), progress: z.number().optional() }).nullish(),
})

const image = computed(() => {
  const parsed = imageSchema.safeParse(store.projectLibrary?.image)
  return parsed.success ? parsed.data : undefined
})

const imagePending = computed(
  () => image.value && !["ready", "failed"].includes(image.value.status),
)

const canRetry = computed(
  () =>
    image.value?.status === "failed" ||
    store.projectLibrary?.diagnostics.some(item => item.phase === "image") ||
    (store.projectLibrary?.desiredSnapshotId && !image.value),
)

const issues = computed(() => [
  ...new Set([
    ...(store.projectLibrary?.diagnostics.map(item => item.message) ?? []),
    ...(image.value?.error ? [image.value.error] : []),
    ...(store.catalog?.overlay.enabled ? store.catalog.overlay.conflicts : []),
  ]),
])

const status = computed(() =>
  issues.value.length
    ? "Library needs attention"
    : imagePending.value
      ? "Preparing library…"
      : image.value?.status === "ready"
        ? "Library ready"
        : packages.value.length
          ? "Waiting for library preparation"
          : "No packages selected",
)

function edit(item: SelectedLibraryPackage | null) {
  selected.value = item
  store.error = undefined
  visible.value = true
}

function confirmDelete(item: SelectedLibraryPackage) {
  deleteTarget.value = item
  store.error = undefined
  deleteVisible.value = true
}

async function remove() {
  if (deleteTarget.value && (await store.removePackage(deleteTarget.value.packageName))) {
    deleteVisible.value = false
    deleteTarget.value = null
  }
}

async function setOverlay(enabled: boolean | null) {
  savingOverlay.value = true

  try {
    await store.setLocalOverlay(enabled === true)
  } finally {
    savingOverlay.value = false
  }
}
</script>

<template>
  <section class="library-settings">
    <SettingsPageHeader
      title="Project Library"
      fallback-icon="mdi-bookshelf"
      description="Choose the packages and exact versions available to this project."
    >
      <template #actions>
        <VBtn color="primary" prepend-icon="mdi-plus" :disabled="store.busy" @click="edit(null)"
          >Add package</VBtn
        >
      </template>
    </SettingsPageHeader>

    <VAlert
      v-if="store.error && !visible && !deleteVisible"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      >{{ store.error }}</VAlert
    >

    <VCard variant="outlined" class="library-section mb-6">
      <div class="section-heading">
        <div>
          <h2 class="text-subtitle-1 font-weight-medium">Packages</h2>
          <p class="text-body-2 text-medium-emphasis">
            Version changes apply to future operations. Existing deployments keep their recorded
            versions.
          </p>
        </div>
        <VBtn
          variant="text"
          prepend-icon="mdi-package-up"
          aria-label="Update all packages"
          :disabled="store.busy || !packages.length"
          @click="store.updateAll()"
          >Update all</VBtn
        >
      </div>
      <VDataTable
        :headers="headers"
        :items="packages"
        item-value="packageName"
        :items-per-page="-1"
        hide-default-footer
        class="package-table"
      >
        <template #item.packageName="{ item }"
          ><span class="font-weight-medium">{{ item.packageName }}</span></template
        >
        <template #item.version="{ item }"><code>{{ item.version }}</code></template>
        <template #item.actions="{ item }">
          <div class="d-flex justify-center ga-1">
            <TableItemAction
              icon="mdi-pencil-outline"
              tooltip="Edit package"
              :disabled="store.busy"
              @click="edit(item)"
            />
            <TableItemAction
              icon="mdi-delete-outline"
              tooltip="Delete package"
              color="error"
              :disabled="store.busy"
              @click="confirmDelete(item)"
            />
          </div>
        </template>
        <template #no-data>
          <div class="py-8 text-center">
            <p class="text-body-1 mb-1">No packages added</p>
            <p class="text-body-2 text-medium-emphasis">
              Add a package to make its components available in this project.
            </p>
          </div>
        </template>
      </VDataTable>
    </VCard>

    <VCard variant="outlined" class="library-section mb-6">
      <VCardText>
        <div class="d-flex align-center justify-space-between ga-4">
          <div class="d-flex align-center ga-2">
            <VIcon
              :color="issues.length ? 'warning' : image?.status === 'ready' ? 'success' : undefined"
              size="20"
              >{{ issues.length ? 'mdi-alert-circle-outline' : image?.status === 'ready' ? 'mdi-check-circle-outline' : 'mdi-package-variant' }}</VIcon
            >
            <span class="text-body-2 font-weight-medium">{{ status }}</span>
          </div>
          <VBtn
            v-if="canRetry"
            variant="text"
            :disabled="store.busy"
            @click="store.retryDesiredImage()"
            >Retry</VBtn
          >
        </div>
        <VProgressLinear
          v-if="imagePending"
          :indeterminate="image?.progress?.progress === undefined"
          :model-value="image?.progress?.progress"
          color="primary"
          class="mt-3"
        />
        <p v-if="issues.length" class="text-body-2 text-medium-emphasis mt-2">
          Some library changes could not be applied. Review the details below.
        </p>
        <VExpansionPanels
          v-if="issues.length || image?.progress?.message"
          variant="accordion"
          flat
          class="mt-3"
        >
          <VExpansionPanel title="Technical details">
            <VExpansionPanelText>
              <div class="library-details">
                <p v-for="issue in issues" :key="issue" class="mb-2">{{ issue }}</p>
                <pre v-if="image?.progress?.message">{{ image.progress.message }}</pre>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
      </VCardText>
    </VCard>

    <VCard variant="outlined" class="library-section">
      <VCardText class="d-flex align-start justify-space-between ga-6">
        <div>
          <h2 class="text-subtitle-1 font-weight-medium mb-1">Local development</h2>
          <p class="text-body-2 text-medium-emphasis">
            Use local workspace sources alongside the selected packages. Requires the system-managed
            local runtime.
          </p>
          <p
            v-if="store.projectLibrary?.localOverlayEnabled"
            class="text-caption mt-2"
            :class="store.catalog?.overlay.active ? 'text-medium-emphasis' : 'text-warning'"
          >
            {{ store.catalog?.overlay.active ? 'Local sources are active.' : store.catalog?.overlay.reason ?? 'Local sources are not available on this runtime.' }}
          </p>
          <p class="text-caption text-medium-emphasis mt-2">Changes are saved automatically.</p>
        </div>
        <VSwitch
          :model-value="store.projectLibrary?.localOverlayEnabled ?? false"
          :disabled="store.busy"
          :loading="savingOverlay"
          aria-label="Use local sources"
          color="primary"
          hide-details
          inset
          class="flex-grow-0 flex-shrink-0"
          @update:model-value="setOverlay"
        />
      </VCardText>
    </VCard>
  </section>

  <LibraryPackageDialog v-model="visible" :project-id="projectId" :item="selected" />
  <VDialog v-model="deleteVisible" max-width="480" :persistent="store.busy">
    <VCard title="Remove package">
      <VCardText>
        <VAlert v-if="store.error" type="error" variant="tonal" density="compact" class="mb-4"
          >{{ store.error }}</VAlert
        >
        Remove "{{ deleteTarget?.packageName }}" from this project? Existing deployed instances keep
        their recorded package versions.
      </VCardText>
      <VCardActions
        ><VSpacer /><VBtn :disabled="store.busy" @click="deleteVisible = false">Cancel</VBtn
        ><VBtn color="error" :loading="store.busy" @click="remove"
          >Remove package</VBtn
        ></VCardActions
      >
    </VCard>
  </VDialog>
</template>

<style scoped>
.library-settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}

.library-section {
  flex: none;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.section-heading .v-btn {
  flex-shrink: 0;
}

.package-table :deep(th:first-child),
.package-table :deep(td:first-child) {
  padding-left: 16px;
}

.library-details {
  max-height: 180px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@media (max-width: 600px) {
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
