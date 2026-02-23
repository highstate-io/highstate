<script setup lang="ts">
import { Icon } from "@iconify/vue"
import {
  getNavigateTargetForPaletteItem,
  getPaletteItemKey,
  getSearchHitFallbackIcon,
  parseGlobalSearchQuery,
  toGroupsFromIdsResult,
  toGroupsFromTextResult,
  type GlobalSearchPaletteGroup,
  type GlobalSearchPaletteItem,
} from "../business"

const visible = ref(false)
const query = ref("")
const loading = ref(false)
const groups = ref<GlobalSearchPaletteGroup[]>([])

const searchField = ref<HTMLInputElement | null>(null)

const projectsStore = useProjectsStore()
const { $client } = useNuxtApp()

const resolveProjectTitle = (projectId: string): string => {
  const project = projectsStore.getById(projectId)
  return project?.meta.title ?? project?.name ?? projectId
}

const clearResults = () => {
  groups.value = []
  loading.value = false
}

const runSearchCounter = ref(0)

const runSearch = async () => {
  if (!visible.value) {
    return
  }

  const text = query.value

  const plan = parseGlobalSearchQuery(text)

  if (plan.type === "empty") {
    clearResults()
    return
  }

  const requestId = ++runSearchCounter.value
  loading.value = true

  try {
    if (plan.type === "id") {
      const results = await $client.search.searchByIds.query({ ids: plan.ids })

      if (requestId !== runSearchCounter.value) {
        return
      }

      groups.value = toGroupsFromIdsResult(results, { resolveProjectTitle })
      return
    }

    const result = await $client.search.searchByText.query({ text: plan.text })

    if (requestId !== runSearchCounter.value) {
      return
    }

    groups.value = toGroupsFromTextResult(result, { resolveProjectTitle })
  } finally {
    if (requestId === runSearchCounter.value) {
      loading.value = false
    }
  }
}

const debouncedRunSearch = useDebounceFn(async () => {
  await runSearch()
}, 200)

watch([visible, query], ([isVisible]) => {
  if (!isVisible) {
    return
  }

  void debouncedRunSearch()
})

watch(visible, async isVisible => {
  if (isVisible) {
    await nextTick()
    searchField.value?.focus()
    return
  }

  query.value = ""
  clearResults()
})

const openItem = async (item: GlobalSearchPaletteItem) => {
  visible.value = false

  const target = getNavigateTargetForPaletteItem(item)
  if (!target) {
    return
  }

  await navigateTo(target)
}

useEventListener(window, "keydown", event => {
  const key = event.key.toLowerCase()

  if ((event.ctrlKey || event.metaKey) && key === "k") {
    event.preventDefault()
    visible.value = true
    return
  }

  if (key === "escape" && visible.value) {
    event.preventDefault()
    visible.value = false
  }
})
</script>

<template>
  <VDialog v-model="visible" max-width="900" persistent>
    <VCard>
      <VCardText class="pa-4">
        <VTextField
          ref="searchField"
          v-model="query"
          label="Search"
          variant="outlined"
          density="compact"
          hide-details
          autofocus
        />

        <VProgressLinear v-if="loading" indeterminate class="mt-2" />

        <VList v-if="groups.length > 0" density="compact" class="mt-2">
          <template v-for="group in groups" :key="group.projectId">
            <VListSubheader>
              <div class="d-flex align-center justify-space-between w-100">
                <div class="text-body-2">{{ group.projectTitle }}</div>
                <VChip
                  size="x-small"
                  variant="outlined"
                  :prepend-icon="
                    group.unlockState === 'locked' ? 'mdi-lock' : 'mdi-lock-open-variant'
                  "
                >
                  {{ group.unlockState === "locked" ? "Locked" : "Unlocked" }}
                </VChip>
              </div>
            </VListSubheader>

            <VListItem
              v-for="item in group.items"
              :key="getPaletteItemKey(item)"
              @click="openItem(item)"
            >
              <template #prepend>
                <template v-if="item.type === 'hit' && item.hit.meta.icon">
                  <Icon :icon="item.hit.meta.icon" width="18" class="mr-2" />
                </template>
                <template v-else-if="item.type === 'hit'">
                  <VIcon :icon="getSearchHitFallbackIcon(item.hit.kind)" class="mr-2" />
                </template>
                <template v-else>
                  <VIcon icon="mdi-lock" class="mr-2" />
                </template>
              </template>

              <VListItemTitle class="text-body-2">
                <template v-if="item.type === 'hit'">
                  {{ item.hit.meta.title ?? item.hit.id }}
                </template>
                <template v-else>
                  {{ item.id }}
                </template>
              </VListItemTitle>

              <VListItemSubtitle class="text-caption">
                <template v-if="item.type === 'hit'">
                  {{ item.hit.meta.description ?? item.hit.id }}
                </template>
                <template v-else>Match found (project locked)</template>
              </VListItemSubtitle>

              <template #append>
                <div class="text-caption text-medium-emphasis">
                  {{ item.type === "hit" ? item.hit.id : item.id }}
                </div>
              </template>
            </VListItem>

            <VDivider class="my-2" />
          </template>
        </VList>

        <div v-else-if="query.trim().length > 0 && !loading" class="text-caption mt-2">
          No results
        </div>
      </VCardText>
    </VCard>
  </VDialog>
</template>
