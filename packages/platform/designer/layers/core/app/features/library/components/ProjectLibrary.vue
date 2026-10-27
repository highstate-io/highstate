<script setup lang="ts">
import { z } from "zod"
import LibraryPackage from "./LibraryPackage.vue"

const { projectId } = defineProps<{ projectId: string }>()
const store = (await useProjectLibraryStore.async(projectId)).library
const packageName = ref("")
const version = ref("")
const versions = ref<string[]>([])
const listing = ref(false)
const listError = ref<string>()
let request = 0
watch(packageName, () => {
  request++
  versions.value = []
  version.value = ""
  listError.value = undefined
  listing.value = false
})
const loadVersions = async () => {
  const current = ++request
  listing.value = true
  listError.value = undefined
  try {
    const result = await store.listPackageVersions(packageName.value.trim())
    if (current === request) versions.value = result
  } catch (cause) {
    if (current === request)
      listError.value = cause instanceof Error ? cause.message : "Could not list package versions"
  } finally {
    if (current === request) listing.value = false
  }
}
const addPackage = async () => {
  if (await store.addPackage(packageName.value.trim(), version.value.trim())) {
    packageName.value = ""
  }
}
const imageSchema = z.object({
  status: z.string(),
  error: z.string().nullish(),
  progress: z.object({ message: z.string().optional(), progress: z.number().optional() }).nullish(),
})
const image = computed(() => {
  const result = imageSchema.safeParse(store.projectLibrary?.image)
  return result.success ? result.data : undefined
})
const imagePending = computed(
  () => image.value && !["ready", "failed"].includes(image.value.status),
)
const imageFailed = computed(
  () =>
    image.value?.status === "failed" ||
    store.projectLibrary?.diagnostics.some(item => item.phase === "image"),
)
</script>

<template>
  <div class="d-flex flex-column ga-4 pa-4">
    <div class="d-flex align-center justify-space-between">
      <h2 class="text-h6">Project library</h2>
      <VBtn
        :disabled="store.busy || !store.projectLibrary?.selectedPackages.length"
        @click="store.updateAll()"
        >Update all</VBtn
      >
    </div>
    <VProgressLinear v-if="store.busy" indeterminate color="primary" />
    <VAlert v-if="store.error" type="error" density="compact">{{ store.error }}</VAlert>
    <VAlert
      v-for="diagnostic in store.projectLibrary?.diagnostics ?? []"
      :key="diagnostic.phase"
      type="warning"
      density="compact"
    >
      {{ diagnostic.phase }}: {{ diagnostic.message }}
    </VAlert>

    <VCard variant="outlined" class="pa-3">
      <div class="text-subtitle-2">
        Snapshot image:
        {{ image?.status ?? (store.projectLibrary?.desiredSnapshotId ? 'Awaiting build' : 'No snapshot') }}
      </div>
      <VProgressLinear
        v-if="imagePending"
        :indeterminate="image?.progress?.progress === undefined"
        :model-value="image?.progress?.progress"
        color="primary"
        class="my-2"
      />
      <div v-if="image?.progress?.message" class="image-progress text-caption">
        {{ image.progress.message }}
      </div>
      <VAlert v-if="image?.error" type="error" density="compact" class="my-2"
        >{{ image.error }}</VAlert
      >
      <VBtn
        v-if="imageFailed || (store.projectLibrary?.desiredSnapshotId && !image)"
        :disabled="store.busy"
        class="mt-2"
        @click="store.retryDesiredImage()"
        >Retry image build</VBtn
      >
    </VCard>

    <VCard variant="outlined" class="pa-3">
      <VSwitch
        :model-value="store.catalog?.overlay.enabled ?? false"
        :disabled="store.busy"
        label="Local library overlay"
        hide-details
        @update:model-value="store.setLocalOverlay($event === true)"
      />
      <div class="text-caption">
        {{ store.catalog?.overlay.active ? 'Active' : 'Inactive' }}
        — requires the well-known local runtime.
      </div>
      <VAlert v-if="store.catalog?.overlay.reason" type="warning" density="compact" class="mt-2"
        >{{ store.catalog.overlay.reason }}</VAlert
      >
      <div
        v-for="conflict in store.catalog?.overlay.conflicts ?? []"
        :key="conflict"
        class="text-caption"
      >
        Conflict: {{ conflict }}
      </div>
    </VCard>

    <LibraryPackage
      v-for="pkg in store.projectLibrary?.selectedPackages ?? []"
      :key="pkg.packageName"
      :project-id="projectId"
      :package-name="pkg.packageName"
      :version="pkg.version"
    />
    <div v-if="!store.projectLibrary?.selectedPackages.length" class="text-medium-emphasis">
      No packages selected.
    </div>

    <VCard variant="outlined" class="pa-3">
      <h3 class="text-subtitle-1 mb-3">Add package</h3>
      <VTextField
        v-model="packageName"
        label="npm package name"
        :disabled="store.busy"
        density="compact"
      />
      <VCombobox
        v-model="version"
        :items="versions"
        label="Exact version (for example 1.2.3)"
        :disabled="store.busy"
        density="compact"
      />
      <div class="d-flex ga-2">
        <VBtn :loading="listing" :disabled="store.busy || !packageName.trim()" @click="loadVersions"
          >List versions</VBtn
        >
        <VBtn :disabled="store.busy || !packageName.trim() || !version.trim()" @click="addPackage"
          >Add package</VBtn
        >
      </div>
      <VAlert v-if="listError" type="error" density="compact" class="mt-2">{{ listError }}</VAlert>
    </VCard>
  </div>
</template>

<style scoped>
.image-progress {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
