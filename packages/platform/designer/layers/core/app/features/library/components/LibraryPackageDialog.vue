<script setup lang="ts">
import type { SelectedLibraryPackage } from "@highstate/contract"

const { projectId, item } = defineProps<{
  projectId: string
  item: SelectedLibraryPackage | null
}>()
const visible = defineModel<boolean>({ required: true })
const store = (await useProjectLibraryStore.async(projectId)).library
const packageName = ref("")
const version = ref<string | null>("")
const versions = ref<string[]>([])
const listing = ref(false)
const listError = ref("")
let request = 0

watch(packageName, () => {
  request++
  versions.value = []
  listError.value = ""
  listing.value = false
  if (!item) {
    version.value = ""
  }
})

watch(visible, open => {
  request++
  if (!open) {
    return
  }

  packageName.value = item?.packageName ?? ""
  version.value = item?.version ?? ""
  versions.value = []
  listError.value = ""
})

watchDebounced(
  [visible, packageName],
  async () => {
    const current = ++request
    versions.value = []
    listError.value = ""
    listing.value = false
    if (!visible.value || !packageName.value.trim()) {
      return
    }

    listing.value = true
    try {
      const result = await store.listPackageVersions(packageName.value.trim())
      if (current === request) {
        versions.value = result
      }
    } catch (cause) {
      if (current === request) {
        listError.value = cause instanceof Error ? cause.message : "Could not list package versions"
      }
    } finally {
      if (current === request) {
        listing.value = false
      }
    }
  },
  { debounce: 300 },
)

async function save() {
  const name = packageName.value.trim()
  const exactVersion = version.value?.trim()
  if (!name || !exactVersion || store.busy) {
    return
  }

  const saved = item
    ? await store.updatePackage(item.packageName, exactVersion)
    : await store.addPackage(name, exactVersion)
  if (saved) {
    visible.value = false
  }
}
</script>

<template>
  <VDialog v-model="visible" max-width="560" :persistent="store.busy">
    <VCard :title="item ? 'Edit library package' : 'Create library package'">
      <VForm @submit.prevent="save">
        <VCardText>
          <VAlert v-if="store.error" type="error" density="compact" class="mb-4"
            >{{ store.error }}</VAlert
          >
          <VTextField
            v-model="packageName"
            label="Package name"
            variant="outlined"
            density="compact"
            :disabled="store.busy || !!item"
            placeholder="@scope/package"
            class="mb-3"
          />
          <VCombobox
            v-model="version"
            :items="versions"
            :loading="listing"
            label="Exact version"
            variant="outlined"
            density="compact"
            :disabled="store.busy"
            hint="Choose a published version or enter an exact version, for example 1.2.3."
            persistent-hint
          />
          <VAlert v-if="listError" type="warning" density="compact" class="mt-4"
            >{{ listError }}</VAlert
          >
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn :disabled="store.busy" @click="visible = false">Cancel</VBtn>
          <VBtn
            color="primary"
            type="submit"
            :loading="store.busy"
            :disabled="!packageName.trim() || !version?.trim()"
            >Save</VBtn
          >
        </VCardActions>
      </VForm>
    </VCard>
  </VDialog>
</template>
