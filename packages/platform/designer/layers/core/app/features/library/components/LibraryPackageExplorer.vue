<script setup lang="ts">
const { projectId } = defineProps<{ projectId: string }>()
const packageName = defineModel<string>({ required: true })
const version = defineModel<string | null>("version", { required: true })
const { $client } = useNuxtApp()
const query = ref("")
const scope = ref("")
const offset = ref(0)
const searching = ref(false)
const loadingDetails = ref(false)
const error = ref("")
const detailsError = ref("")
const registries = ref<Awaited<ReturnType<typeof $client.library.listRegistries.query>>>([])
const results = shallowRef<Awaited<ReturnType<typeof $client.library.searchPackages.query>>>()
const details = shallowRef<Awaited<ReturnType<typeof $client.library.getPackageInfo.query>>>()
let searchRequest = 0
let detailRequest = 0

onMounted(async () => {
  try {
    registries.value = await $client.library.listRegistries.query({ projectId })
  } catch {
    error.value = "Could not load registries. You can still enter a package name below."
  }
})

const registryOptions = computed(() =>
  registries.value.map(item => ({
    title: `${new URL(item.registryUrl).host}${item.scope ? ` · ${item.scope}` : " · default"}`,
    value: item.scope,
  })),
)

watch([query, scope], () => {
  searchRequest++
  offset.value = 0
  results.value = undefined
  error.value = ""
})

watchDebounced(
  [query, scope, offset],
  async () => {
    const current = ++searchRequest

    if (!query.value.trim()) {
      searching.value = false
      return
    }

    searching.value = true

    try {
      const result = await $client.library.searchPackages.query({
        projectId,
        query: query.value.trim(),
        scope: scope.value,
        offset: offset.value,
      })

      if (current === searchRequest) {
        results.value = result
      }
    } catch (cause) {
      if (current === searchRequest) {
        error.value = cause instanceof Error ? cause.message : "Package search failed"
      }
    } finally {
      if (current === searchRequest) {
        searching.value = false
      }
    }
  },
  { debounce: 300 },
)

watch(packageName, () => {
  detailRequest++
  details.value = undefined
  detailsError.value = ""
  loadingDetails.value = false
})

watchDebounced(
  packageName,
  async name => {
    const current = ++detailRequest

    if (!name.trim()) {
      return
    }

    loadingDetails.value = true

    try {
      const info = await $client.library.getPackageInfo.query({
        projectId,
        packageName: name.trim(),
      })

      if (current === detailRequest) {
        details.value = info
      }
    } catch {
      if (current === detailRequest) {
        detailsError.value =
          "Package details are unavailable. You can still enter an exact version below."
      }
    } finally {
      if (current === detailRequest) {
        loadingDetails.value = false
      }
    }
  },
  { debounce: 300, immediate: true },
)

onBeforeUnmount(() => {
  searchRequest++
  detailRequest++
})
</script>

<template>
  <div class="package-explorer mb-6">
    <div class="explorer-search">
      <VTextField
        v-model="query"
        label="Search packages"
        placeholder="Name, description, or keywords"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        :loading="searching"
      />
      <VSelect
        v-model="scope"
        :items="registryOptions"
        label="Registry"
        variant="outlined"
        density="compact"
        hide-details
      />
    </div>
    <p class="text-caption text-medium-emphasis mt-2">
      Registry scopes follow this project's runtime configuration. Private registry credentials stay
      on the backend.
    </p>
    <VAlert v-if="error" type="error" variant="tonal" density="compact" class="mt-3"
      >{{ error }}</VAlert
    >
    <p v-if="results && !results.searchable" class="text-caption text-medium-emphasis mt-3">
      This registry does not support npm search. Enter an exact package name to look it up.
    </p>
    <div class="explorer-content mt-4">
      <div class="explorer-results">
        <p v-if="!query" class="text-body-2 text-medium-emphasis pa-4">
          Search npm or a configured registry, or enter a package name below.
        </p>
        <p
          v-else-if="results && !results.packages.length && !searching"
          class="text-body-2 text-medium-emphasis pa-4"
        >
          No matching packages. Try another query or an exact package name.
        </p>
        <VList v-else aria-label="Package search results" density="compact" class="py-0">
          <VListItem
            v-for="pkg in results?.packages ?? []"
            :key="pkg.name"
            :active="packageName === pkg.name"
            :title="pkg.name"
            :subtitle="pkg.description"
            @click="packageName = pkg.name"
          >
            <template #append><span class="text-caption ml-3">{{ pkg.version }}</span></template>
          </VListItem>
        </VList>
      </div>
      <div class="explorer-details pa-4">
        <VProgressLinear v-if="loadingDetails" indeterminate color="primary" class="mb-3" />
        <template v-if="details">
          <h3 class="text-subtitle-1 font-weight-medium">{{ details.name }}</h3>
          <p class="text-body-2 mt-2">{{ details.description || 'No description provided.' }}</p>
          <div class="d-flex flex-wrap ga-2 mt-3">
            <VChip v-if="details.license" size="small" label>{{ details.license }}</VChip>
            <VChip
              v-for="(release, tag) in details.tags"
              :key="tag"
              size="small"
              label
              @click="version = release"
              >{{ tag }}: {{ release }}</VChip
            >
          </div>
          <p class="text-caption text-medium-emphasis mt-3">
            {{ details.versions.length }}
            published versions. Choose an exact version below. Adding a package validates its
            Highstate compatibility.
          </p>
          <VExpansionPanels variant="accordion" flat class="mt-3">
            <VExpansionPanel title="Versions">
              <VExpansionPanelText>
                <VList density="compact" aria-label="Published versions">
                  <VListItem
                    v-for="release in details.versions"
                    :key="release.version"
                    :title="release.version"
                    :subtitle="release.deprecated ? `Deprecated: ${release.deprecated}` : release.publishedAt"
                    :active="version === release.version"
                    @click="version = release.version"
                  />
                </VList>
              </VExpansionPanelText>
            </VExpansionPanel>
            <VExpansionPanel v-if="details.readme" title="README"
              ><VExpansionPanelText
                ><pre class="package-readme">{{ details.readme }}</pre></VExpansionPanelText
              ></VExpansionPanel
            >
          </VExpansionPanels>
        </template>
        <p v-else class="text-body-2 text-medium-emphasis">
          {{ detailsError || 'Select a package to see its description, release tags, and README.' }}
        </p>
      </div>
    </div>
    <div
      v-if="results?.searchable && (offset || results.total > 25)"
      class="d-flex align-center justify-space-between mt-2"
    >
      <span class="text-caption text-medium-emphasis"
        >Results {{ offset + 1 }}–{{ Math.min(offset + 25, results.total) }}
        of {{ results.total }}</span
      >
      <div class="d-flex ga-1">
        <VBtn
          icon="mdi-chevron-left"
          aria-label="Previous packages"
          variant="text"
          size="small"
          :disabled="searching || offset === 0"
          @click="offset -= 25"
        />
        <VBtn
          icon="mdi-chevron-right"
          aria-label="Next packages"
          variant="text"
          size="small"
          :disabled="searching || offset + 25 >= results.total || offset >= 1000"
          @click="offset += 25"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.explorer-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
}
.explorer-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}
.explorer-results,
.explorer-details {
  min-width: 0;
  height: 280px;
  overflow-y: auto;
}
.explorer-results {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.package-readme {
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .explorer-search,
  .explorer-content {
    grid-template-columns: minmax(0, 1fr);
  }
  .explorer-results {
    height: 180px;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
  .explorer-details {
    height: auto;
    max-height: 220px;
  }
}
</style>
