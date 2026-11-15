<script setup lang="ts">
import type { CollectionQuery } from "@highstate/backend/shared"
import type { SelectedLibraryPackage } from "@highstate/contract"
import { z } from "zod"
import {
  baseHeaders,
  SettingsDataTable,
  SettingsListPage,
  TableItemAction,
} from "#layers/core/app/features/settings"
import { queryLibraryPackages } from "../business/packages"
import LibraryPackageDialog from "./LibraryPackageDialog.vue"

const { projectId } = defineProps<{ projectId: string }>()
const store = (await useProjectLibraryStore.async(projectId)).library
const visible = ref(false)
const selected = shallowRef<SelectedLibraryPackage | null>(null)
const deleteTarget = shallowRef<SelectedLibraryPackage | null>(null)
const deleteVisible = ref(false)
const settingsVisible = ref(false)
const overlayEnabled = ref(false)
const search = ref("")
const page = ref(1)
const itemsPerPage = ref(20)
const sortBy = ref<CollectionQuery["sortBy"]>([{ key: "meta.title", order: "asc" }])
const headers = [baseHeaders.name, { title: "Version", key: "version" }, baseHeaders.actions]
const packages = computed(() => store.projectLibrary?.selectedPackages ?? [])
const data = computed(() =>
  queryLibraryPackages(packages.value, search.value, sortBy.value, page.value, itemsPerPage.value),
)
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

watch([search, itemsPerPage], () => {
  page.value = 1
})
watch(
  () => data.value.total,
  total => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(total / itemsPerPage.value)))
  },
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

function editSettings() {
  overlayEnabled.value = store.projectLibrary?.localOverlayEnabled ?? false
  store.error = undefined
  settingsVisible.value = true
}

async function saveSettings() {
  if (await store.setLocalOverlay(overlayEnabled.value)) {
    settingsVisible.value = false
  }
}
</script>

<template>
  <SettingsListPage
    title="Project Library"
    icon="mdi-bookshelf"
    description="Manage exact package versions and local development sources for this project."
  >
    <template #actions>
      <TableItemAction
        icon="mdi-cog-outline"
        tooltip="Edit library settings"
        :disabled="store.busy"
        @click="editSettings"
      />
      <TableItemAction
        icon="mdi-package-up"
        tooltip="Update all packages"
        :disabled="store.busy || !packages.length"
        @click="store.updateAll()"
      />
      <VBtn color="primary" prepend-icon="mdi-plus" :disabled="store.busy" @click="edit(null)"
        >Create</VBtn
      >
    </template>
    <template #default="{ height }">
      <VAlert
        v-if="store.error && !visible && !deleteVisible && !settingsVisible"
        type="error"
        density="compact"
        class="mb-4"
        >{{ store.error }}</VAlert
      >
      <VAlert
        v-for="(diagnostic, index) in store.projectLibrary?.diagnostics ?? []"
        :key="`${diagnostic.phase}/${index}`"
        type="warning"
        density="compact"
        class="mb-4"
        >{{ diagnostic.phase }}: {{ diagnostic.message }}</VAlert
      >
      <div class="d-flex align-center flex-wrap ga-3 mb-4">
        <VChip
          size="small"
          variant="tonal"
          :color="image?.status === 'failed' ? 'error' : image?.status === 'ready' ? 'success' : undefined"
          >Snapshot image:
          {{ image?.status ?? (store.projectLibrary?.desiredSnapshotId ? 'Awaiting build' : 'No snapshot') }}</VChip
        >
        <TableItemAction
          v-if="canRetry"
          icon="mdi-restart"
          tooltip="Retry image build"
          :disabled="store.busy"
          @click="store.retryDesiredImage()"
        />
        <VChip size="small" variant="tonal"
          >Local overlay:
          {{ store.catalog?.overlay.active ? 'Active' : store.projectLibrary?.localOverlayEnabled ? 'Inactive' : 'Disabled' }}</VChip
        >
        <span v-if="store.catalog?.overlay.reason" class="text-caption text-medium-emphasis"
          >{{ store.catalog.overlay.reason }}</span
        >
      </div>
      <VProgressLinear
        v-if="imagePending"
        :indeterminate="image?.progress?.progress === undefined"
        :model-value="image?.progress?.progress"
        color="primary"
        class="mb-3"
      />
      <div v-if="image?.progress?.message" class="text-caption text-pre-wrap mb-3">
        {{ image.progress.message }}
      </div>
      <VAlert v-if="image?.error" type="error" density="compact" class="mb-4"
        >{{ image.error }}</VAlert
      >
      <VAlert
        v-for="conflict in store.catalog?.overlay.conflicts ?? []"
        :key="conflict"
        type="warning"
        density="compact"
        class="mb-4"
        >{{ conflict }}</VAlert
      >
      <SettingsDataTable
        v-model:search="search"
        v-model:sort-by="sortBy"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :data="data"
        :loading="store.busy"
        :height="height"
      >
        <template #item.actions="{ item }">
          <div class="d-flex justify-center ga-1">
            <TableItemAction
              icon="mdi-pencil-outline"
              tooltip="Edit package"
              :disabled="store.busy"
              @click="edit(item)"
            />
            <TableItemAction
              icon="mdi-package-up"
              tooltip="Update package to latest"
              :disabled="store.busy"
              @click="store.updatePackage(item.packageName)"
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
      </SettingsDataTable>
    </template>
  </SettingsListPage>
  <LibraryPackageDialog v-model="visible" :project-id="projectId" :item="selected" />
  <VDialog v-model="deleteVisible" max-width="480" :persistent="store.busy">
    <VCard title="Delete library package">
      <VCardText>
        <VAlert v-if="store.error" type="error" density="compact" class="mb-4"
          >{{ store.error }}</VAlert
        >
        Remove "{{ deleteTarget?.packageName }}" from this project's selected packages? Deployed
        instances retain their recorded package provenance.
      </VCardText>
      <VCardActions
        ><VSpacer /><VBtn :disabled="store.busy" @click="deleteVisible = false">Cancel</VBtn
        ><VBtn color="error" :loading="store.busy" @click="remove">Delete</VBtn></VCardActions
      >
    </VCard>
  </VDialog>
  <VDialog v-model="settingsVisible" max-width="560" :persistent="store.busy">
    <VCard title="Edit library settings">
      <VForm @submit.prevent="saveSettings">
        <VCardText>
          <VAlert v-if="store.error" type="error" density="compact" class="mb-4"
            >{{ store.error }}</VAlert
          >
          <VSwitch
            v-model="overlayEnabled"
            label="Local library overlay"
            :disabled="store.busy"
            color="primary"
            hide-details
          />
          <p class="text-caption text-medium-emphasis mt-2">
            Use local development sources on the system-managed local runtime. Packaged library
            selections remain unchanged.
          </p>
        </VCardText>
        <VCardActions
          ><VSpacer /><VBtn :disabled="store.busy" @click="settingsVisible = false">Cancel</VBtn
          ><VBtn type="submit" color="primary" :loading="store.busy">Save</VBtn></VCardActions
        >
      </VForm>
    </VCard>
  </VDialog>
</template>
