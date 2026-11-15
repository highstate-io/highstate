<script setup lang="ts">
const { packageName, versions, loading, error, disabled } = defineProps<{
  packageName: string
  versions: string[]
  loading?: boolean
  error?: string
  disabled?: boolean
}>()

const version = defineModel<string>({ required: true })
const emit = defineEmits<{ open: [] }>()
const open = ref(false)
const search = ref("")
const page = ref(0)

const filtered = computed(() =>
  versions.filter(item => item.toLowerCase().includes(search.value.trim().toLowerCase())),
)

const visibleVersions = computed(() => filtered.value.slice(page.value * 20, (page.value + 1) * 20))

watch(search, () => {
  page.value = 0
})

watch(open, value => {
  if (value) {
    search.value = ""
    page.value = 0
    emit("open")
  }
})
</script>

<template>
  <VMenu v-model="open" :close-on-content-click="false" location="bottom end">
    <template #activator="{ props }">
      <VBtn
        v-bind="props"
        :disabled="disabled"
        variant="text"
        size="small"
        append-icon="mdi-menu-down"
        :aria-label="`Version for ${packageName}`"
        >{{ version || 'Latest' }}</VBtn
      >
    </template>
    <VCard width="300">
      <VCardText class="pa-3 pb-0">
        <VTextField
          v-model="search"
          :aria-label="`Search versions for ${packageName}`"
          placeholder="Search versions"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          autofocus
        />
      </VCardText>
      <VProgressLinear v-if="loading" indeterminate color="primary" class="mt-3" />
      <p v-if="error" class="text-body-2 text-error pa-3">{{ error }}</p>
      <VList
        v-else
        role="listbox"
        :aria-label="`Versions for ${packageName}`"
        density="compact"
        class="version-list"
      >
        <VListItem
          v-for="item in visibleVersions"
          :key="item"
          role="option"
          :aria-selected="version === item"
          :active="version === item"
          :title="item"
          @click="version = item; open = false"
        />
        <VListItem v-if="!loading && !filtered.length" title="No matching versions" />
      </VList>
      <div v-if="filtered.length > 20" class="d-flex align-center justify-space-between px-3 pb-2">
        <span class="text-caption text-medium-emphasis"
          >{{ page * 20 + 1 }}–{{ Math.min((page + 1) * 20, filtered.length) }}
          of {{ filtered.length }}</span
        >
        <div>
          <VBtn
            icon="mdi-chevron-left"
            aria-label="Previous versions"
            size="small"
            variant="text"
            :disabled="page === 0"
            @click="page--"
          />
          <VBtn
            icon="mdi-chevron-right"
            aria-label="Next versions"
            size="small"
            variant="text"
            :disabled="(page + 1) * 20 >= filtered.length"
            @click="page++"
          />
        </div>
      </div>
    </VCard>
  </VMenu>
</template>

<style scoped>
.version-list {
  max-height: 280px;
  overflow-y: auto;
}
</style>
