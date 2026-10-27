<script setup lang="ts">
const { projectId, packageName, version } = defineProps<{
  projectId: string
  packageName: string
  version: string
}>()
const store = (await useProjectLibraryStore.async(projectId)).library
const versions = ref<string[]>([])
const selectedVersion = ref(version)
const loading = ref(false)
const error = ref<string>()
watch(
  () => version,
  value => {
    selectedVersion.value = value
  },
)

const loadVersions = async () => {
  loading.value = true
  error.value = undefined
  try {
    versions.value = await store.listPackageVersions(packageName)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not list package versions"
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <VCard variant="outlined" class="pa-3">
    <div class="text-subtitle-2">{{ packageName }}</div>
    <div class="text-caption mb-2">Selected: {{ version }}</div>
    <VCombobox
      v-model="selectedVersion"
      :items="versions"
      :loading="loading"
      :disabled="store.busy"
      label="Exact version"
      density="compact"
      hide-details
    />
    <div class="d-flex flex-wrap ga-2 mt-2">
      <VBtn size="small" :loading="loading" :disabled="store.busy" @click="loadVersions"
        >List versions</VBtn
      >
      <VBtn
        size="small"
        :disabled="store.busy || !selectedVersion || selectedVersion === version"
        @click="store.updatePackage(packageName, selectedVersion)"
        >Apply version</VBtn
      >
      <VBtn size="small" :disabled="store.busy" @click="store.updatePackage(packageName)"
        >Update latest</VBtn
      >
      <VBtn
        size="small"
        color="error"
        :disabled="store.busy"
        @click="store.removePackage(packageName)"
        >Remove</VBtn
      >
    </div>
    <VAlert v-if="error" type="error" density="compact" class="mt-2">{{ error }}</VAlert>
  </VCard>
</template>
