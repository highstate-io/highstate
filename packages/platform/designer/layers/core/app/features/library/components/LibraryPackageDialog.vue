<script setup lang="ts">
import type { SelectedLibraryPackage } from "@highstate/contract"
import LibraryPackageVersionSelect from "./LibraryPackageVersionSelect.vue"

const { projectId, item } = defineProps<{
  projectId: string
  item: SelectedLibraryPackage | null
}>()

const visible = defineModel<boolean>({ required: true })
const store = (await useProjectLibraryStore.async(projectId)).library
const { $client } = useNuxtApp()
type SearchResult = Awaited<ReturnType<typeof $client.library.searchPackages.query>>
type PackageInfo = Awaited<ReturnType<typeof $client.library.getPackageInfo.query>>
const registries = ref<Awaited<ReturnType<typeof $client.library.listRegistries.query>>>([])
const query = ref("")
const scope = ref("")
const offset = ref(0)
const searching = ref(false)
const error = ref("")
const results = shallowRef<SearchResult>()
const selected = reactive<Record<string, string>>({})
const metadata = reactive<Record<string, PackageInfo>>({})
const loading = reactive<Record<string, boolean>>({})
const metadataErrors = reactive<Record<string, string>>({})
const editVersion = ref("")
let request = 0
let session = 0

const existing = computed(
  () =>
    new Map(
      (store.projectLibrary?.selectedPackages ?? []).map(pkg => [pkg.packageName, pkg.version]),
    ),
)

const options = computed(() =>
  registries.value.map(registry => ({
    title: `${new URL(registry.registryUrl).host}${registry.scope ? ` · ${registry.scope}` : " · default"}`,
    value: registry.scope,
  })),
)

const selectionCount = computed(() => Object.keys(selected).length)
const busy = computed(() => store.busy || Object.values(loading).some(Boolean))

const rows = computed(() => {
  const packages = new Map<string, { name: string; description?: string; version?: string }>()

  for (const [name, version] of existing.value) {
    packages.set(name, { name, version })
  }

  for (const [name, version] of Object.entries(selected)) {
    packages.set(name, { name, version, description: metadata[name]?.description })
  }

  for (const pkg of results.value?.packages ?? []) {
    if (!packages.has(pkg.name)) {
      packages.set(pkg.name, pkg)
    }
  }

  return [...packages.values()]
})

function versions(name: string) {
  const info = metadata[name]
  if (!info) {
    return []
  }

  const releases = info.versions.map(release => release.version)
  const latest = info.tags.latest
  return latest && releases.includes(latest)
    ? [latest, ...releases.filter(version => version !== latest)]
    : releases
}

async function loadMetadata(name: string) {
  if (metadata[name]) {
    return
  }

  if (loading[name]) {
    await until(() => !loading[name]).toBe(true)
    return
  }

  const current = session
  loading[name] = true
  delete metadataErrors[name]

  try {
    const info = await $client.library.getPackageInfo.query({ projectId, packageName: name })

    if (current === session) {
      metadata[name] = info
    }
  } catch (cause) {
    if (current === session) {
      metadataErrors[name] = cause instanceof Error ? cause.message : "Could not load versions"
    }
  } finally {
    if (current === session) {
      loading[name] = false
    }
  }
}

async function include(name: string, included: boolean) {
  if (existing.value.has(name) || store.busy) {
    return
  }

  if (!included) {
    delete selected[name]
    return
  }

  selected[name] = ""
  const current = session
  await loadMetadata(name)

  if (current !== session || !Object.hasOwn(selected, name)) {
    return
  }

  const latest = metadata[name]?.tags.latest
  selected[name] = latest && versions(name).includes(latest) ? latest : ""
}

watch(visible, async open => {
  request++
  session++

  for (const record of [selected, metadata, loading, metadataErrors]) {
    for (const key of Object.keys(record)) {
      delete record[key]
    }
  }

  error.value = ""
  store.error = undefined
  results.value = undefined
  searching.value = false
  query.value = ""
  scope.value = ""
  offset.value = 0
  editVersion.value = item?.version ?? ""

  if (!open) {
    return
  }

  if (item) {
    await loadMetadata(item.packageName)
    return
  }

  try {
    registries.value = await $client.library.listRegistries.query({ projectId })
  } catch {
    error.value = "Could not load registries"
  }
})

watch([query, scope], () => {
  request++
  offset.value = 0
  results.value = undefined
})

watchDebounced(
  [visible, query, scope, offset],
  async () => {
    if (!visible.value || item) {
      return
    }

    const current = ++request

    if (!query.value.trim()) {
      searching.value = false
      results.value = undefined
      return
    }

    searching.value = true
    error.value = ""

    try {
      const result = await $client.library.searchPackages.query({
        projectId,
        query: query.value.trim(),
        scope: scope.value,
        offset: offset.value,
      })

      if (current === request) {
        results.value = result
      }
    } catch (cause) {
      if (current === request) {
        error.value = cause instanceof Error ? cause.message : "Package search failed"
      }
    } finally {
      if (current === request) {
        searching.value = false
      }
    }
  },
  { debounce: 300 },
)

const canSave = computed(
  () =>
    !busy.value &&
    (item
      ? !!editVersion.value
      : selectionCount.value > 0 && Object.values(selected).every(Boolean)),
)

async function save() {
  if (!canSave.value) {
    return
  }

  const saved = item
    ? await store.updatePackage(item.packageName, editVersion.value)
    : await store.addPackages(
        Object.entries(selected).map(([packageName, version]) => ({ packageName, version })),
      )

  if (saved) {
    visible.value = false
  }
}
</script>

<template>
  <VDialog v-model="visible" :max-width="item ? 560 : 880" :persistent="store.busy" scrollable>
    <VCard :title="item ? 'Edit package' : 'Add packages'" class="package-dialog">
      <VCardText class="package-dialog-content">
        <VAlert
          v-if="store.error || error"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          >{{ store.error || error }}</VAlert
        >
        <template v-if="item">
          <div class="d-flex align-center justify-space-between ga-4">
            <span>{{ item.packageName }}</span>
            <LibraryPackageVersionSelect
              v-model="editVersion"
              :package-name="item.packageName"
              :versions="versions(item.packageName)"
              :loading="loading[item.packageName]"
              :error="metadataErrors[item.packageName]"
              :disabled="store.busy"
              @open="loadMetadata(item.packageName)"
            />
          </div>
        </template>
        <template v-else>
          <div class="package-search mb-3">
            <VTextField
              v-model="query"
              label="Search packages"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              hide-details
              :loading="searching"
            />
            <VSelect
              v-model="scope"
              label="Registry"
              :items="options"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <p class="text-caption text-medium-emphasis mb-3">
            Included packages stay at the top. Select packages to add and choose their exact
            versions.
          </p>
          <p v-if="results && !results.searchable" class="text-caption text-medium-emphasis mb-3">
            This registry supports exact package names rather than full-text search.
          </p>
          <VList aria-label="Packages" class="package-list pa-0">
            <VListItem v-for="pkg in rows" :key="pkg.name" class="package-row px-0">
              <template #prepend>
                <VCheckboxBtn
                  :model-value="existing.has(pkg.name) || Object.hasOwn(selected, pkg.name)"
                  :aria-label="`Include ${pkg.name}`"
                  :disabled="store.busy || existing.has(pkg.name) || (!Object.hasOwn(selected, pkg.name) && selectionCount >= 50)"
                  @update:model-value="include(pkg.name, $event === true)"
                />
              </template>
              <VListItemTitle class="text-body-2 font-weight-medium">{{ pkg.name }}</VListItemTitle>
              <VListItemSubtitle v-if="existing.has(pkg.name)">Already included</VListItemSubtitle>
              <VListItemSubtitle v-else-if="pkg.description"
                >{{ pkg.description }}</VListItemSubtitle
              >
              <p v-if="metadataErrors[pkg.name]" class="text-caption text-error mt-1">
                {{ metadataErrors[pkg.name] }}
              </p>
              <template #append>
                <LibraryPackageVersionSelect
                  :model-value="existing.get(pkg.name) ?? selected[pkg.name] ?? pkg.version ?? ''"
                  :package-name="pkg.name"
                  :versions="versions(pkg.name)"
                  :loading="loading[pkg.name]"
                  :error="metadataErrors[pkg.name]"
                  :disabled="store.busy || existing.has(pkg.name)"
                  @open="loadMetadata(pkg.name)"
                  @update:model-value="selected[pkg.name] = $event"
                />
              </template>
            </VListItem>
            <VListItem
              v-if="!rows.length && !searching"
              :title="query ? 'No matching packages' : 'Search for packages to add'"
            />
          </VList>
          <div
            v-if="results?.searchable && (offset || results.total > 25)"
            class="d-flex align-center justify-space-between mt-3"
          >
            <span class="text-caption text-medium-emphasis"
              >{{ offset + 1 }}–{{ Math.min(offset + 25, results.total) }}
              of {{ results.total }} search results</span
            >
            <div>
              <VBtn
                icon="mdi-chevron-left"
                aria-label="Previous packages"
                variant="text"
                size="small"
                :disabled="searching || offset === 0"
                @click="offset -= 25"
              /><VBtn
                icon="mdi-chevron-right"
                aria-label="Next packages"
                variant="text"
                size="small"
                :disabled="searching || offset + 25 >= results.total || offset >= 1000"
                @click="offset += 25"
              />
            </div>
          </div>
        </template>
      </VCardText>
      <VCardActions>
        <span v-if="!item" class="text-caption text-medium-emphasis ml-2"
          >{{ selectionCount }}
          selected</span
        >
        <VSpacer />
        <VBtn :disabled="store.busy" @click="visible = false">Cancel</VBtn>
        <VBtn color="primary" :loading="store.busy" :disabled="!canSave" @click="save"
          >{{ item ? 'Save changes' : 'Add packages' }}</VBtn
        >
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.package-dialog-content {
  min-height: 0;
}
.package-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
}
.package-list {
  max-height: 440px;
  overflow-y: auto;
}
.package-row + .package-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
@media (max-width: 600px) {
  .package-search {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
