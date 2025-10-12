<script setup lang="ts">
import { groupBy, map, pipe, sortBy } from "remeda"
import type { ComponentModel } from "@highstate/contract"
import ComponentTemplate from "./ComponentTemplate.vue"

const { projectId } = defineProps<{
  projectId: string
}>()

const libraryStore = await useProjectLibraryStore.async(projectId)
await until(() => libraryStore.initialized).toBe(true)

const componentsByCategory = computed(() => {
  if (!libraryStore.initialized) {
    return []
  }

  return pipe(
    libraryStore.library.filteredComponents as ComponentModel[],
    groupBy(component => component.meta.category ?? "Uncategorized"),
    groups => Object.entries(groups),
    sortBy(([category]) => (category === "Uncategorized" ? "z" : category)),
    map(([category, components]) => {
      return [
        category,
        sortBy(components, component => component.meta.title ?? component.type),
      ] as const
    }),
  )
})
</script>

<template>
  <div class="d-flex flex-column mt-4 pl-4 pr-4 gr-4 sidebar-container">
    <VTextField
      v-if="libraryStore"
      v-model="libraryStore.library.search"
      class="search"
      variant="outlined"
      density="compact"
      placeholder="Search components"
      hide-details
    />

    <div class="d-flex flex-column align-center gr-4 component-list-container">
      <div
        v-for="[category, components] in componentsByCategory"
        :key="category"
        class="d-flex flex-column gr-4"
      >
        <div class="text-uppercase text-disabled">{{ category }} ({{ components.length }})</div>

        <ComponentTemplate
          v-for="component in components"
          :key="component.type"
          :component="component"
        />
      </div>

      <div
        v-if="(libraryStore.library.filteredComponents.length ?? 0) === 0"
        class="text-center text-uppercase text-disabled"
      >
        No components found
      </div>
    </div>

    <div
      v-if="(libraryStore.library.filteredComponents.length ?? 0) > 0"
      class="mb-2 text-center text-uppercase text-disabled"
    >
      Found {{ libraryStore.library.filteredComponents.length }} component(s)
    </div>
  </div>
</template>

<style scoped>
.sidebar-container {
  height: 100%;
}

.search {
  max-height: 40px;
}

.component-list-container {
  overflow-y: auto;
  margin-right: -14px;
  padding-right: 14px;
  margin-bottom: -8px;
  height: calc(100% - 112px);
  overflow-x: hidden;
}
</style>
