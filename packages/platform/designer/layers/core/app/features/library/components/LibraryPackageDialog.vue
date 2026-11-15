<script setup lang="ts">
import type { SelectedLibraryPackage } from "@highstate/contract"
import {
  exactPackageVersionSchema,
  libraryPackageInputSchema,
  npmPackageNameSchema,
} from "@highstate/backend/shared"
import LibraryPackageExplorer from "./LibraryPackageExplorer.vue"

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
const loaded = ref(false)

const valid = computed(
  () =>
    libraryPackageInputSchema.safeParse({
      packageName: packageName.value.trim(),
      version: version.value?.trim(),
    }).success,
)

let request = 0

watch(packageName, () => {
  request++
  versions.value = []
  listError.value = ""
  listing.value = false
  loaded.value = false

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
  loaded.value = false
})

watchDebounced(
  [visible, packageName],
  async () => {
    const current = ++request
    versions.value = []
    listError.value = ""
    listing.value = false
    loaded.value = false

    if (!visible.value || !npmPackageNameSchema.safeParse(packageName.value.trim()).success) {
      return
    }

    listing.value = true

    try {
      const result = await store.listPackageVersions(packageName.value.trim())

      if (current === request) {
        versions.value = result
        loaded.value = true
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

  if (!valid.value || !exactVersion || store.busy) {
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
  <VDialog v-model="visible" :max-width="item ? 560 : 960" :persistent="store.busy" scrollable>
    <VCard :title="item ? 'Edit package' : 'Add package'">
      <VForm @submit.prevent="save">
        <VCardText>
          <LibraryPackageExplorer
            v-if="visible && !item"
            v-model="packageName"
            v-model:version="version"
            :project-id="projectId"
          />
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
            :rules="[value => !value || npmPackageNameSchema.safeParse(value.trim()).success || 'Enter a valid npm package name.']"
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
            :rules="[value => !value || exactPackageVersionSchema.safeParse(value.trim()).success || 'Enter an exact version, for example 1.2.3.']"
          />
          <p v-if="listError" class="text-caption text-warning mt-3">
            Couldn't load published versions. You can still enter an exact version.
          </p>
          <p v-else-if="loaded && !versions.length" class="text-caption text-medium-emphasis mt-3">
            No published versions found. You can still enter an exact version.
          </p>
          <p v-if="item" class="text-caption text-medium-emphasis mt-3">
            Editing changes the version of this package. To select a different package, add it
            separately.
          </p>
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn :disabled="store.busy" @click="visible = false">Cancel</VBtn>
          <VBtn color="primary" type="submit" :loading="store.busy" :disabled="!valid || store.busy"
            >{{ item ? 'Save changes' : 'Add package' }}</VBtn
          >
        </VCardActions>
      </VForm>
    </VCard>
  </VDialog>
</template>
