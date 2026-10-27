<script setup lang="ts">
import { type ComponentModel, parseVersionedName } from "@highstate/contract"
import { groupBy, map, pipe, sortBy } from "remeda"
import ComponentTemplate from "./ComponentTemplate.vue"
import ProjectLibrary from "../../library/components/ProjectLibrary.vue"

const { projectId } = defineProps<{
  projectId: string
}>()

const libraryStore = await useProjectLibraryStore.async(projectId)
await until(() => libraryStore.initialized).toBe(true)
const showLibrary = ref(false)
const packageOptions = computed(() =>
  [
    ...new Set(
      Object.values(libraryStore.library.catalog?.sources ?? {}).flatMap(source =>
        source.kind === "package" ? [source.packageName] : [],
      ),
    ),
  ].sort(),
)

type ComponentGroup = {
  baseName: string
  components: ComponentModel[]
}

const getComponentBaseName = (component: ComponentModel): string => {
  try {
    return parseVersionedName(component.type)[0]
  } catch {
    return component.type
  }
}

const getComponentVersion = (component: ComponentModel): number => {
  try {
    return parseVersionedName(component.type)[1]
  } catch {
    return 0
  }
}

const componentsByCategory = computed(() => {
  if (!libraryStore.initialized) {
    return []
  }

  const filteredBaseNames = new Set(
    (libraryStore.library.filteredComponents as ComponentModel[]).map(getComponentBaseName),
  )

  const components = (Object.values(libraryStore.library.components) as ComponentModel[]).filter(
    component =>
      filteredBaseNames.has(getComponentBaseName(component)) &&
      libraryStore.library.matchesFilters(component),
  )

  const componentGroups = pipe(
    components,
    groupBy(getComponentBaseName),
    groups => Object.entries(groups),
    map(([baseName, components]) => {
      return {
        baseName,
        components: sortBy(components, component => -getComponentVersion(component)),
      } satisfies ComponentGroup
    }),
  )

  return pipe(
    componentGroups,
    groupBy(group => group.components[0]?.meta.category ?? "Uncategorized"),
    groups => Object.entries(groups),
    sortBy(([category]) => (category === "Uncategorized" ? "z" : category)),
    map(([category, componentGroups]) => {
      return [
        category,
        sortBy(componentGroups, group => group.components[0]?.meta.title ?? group.baseName),
      ] as const
    }),
  )
})

const componentGroupCount = computed(() => {
  return componentsByCategory.value.reduce((total, [, components]) => total + components.length, 0)
})
</script>

<template>
  <div class="d-flex flex-column mt-4 pl-4 pr-4 gr-4 sidebar-container">
    <VBtn variant="outlined" size="small" @click="showLibrary = true">Manage project library</VBtn>
    <VDialog v-model="showLibrary" max-width="760" scrollable>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          Library
          <VBtn
            icon="mdi-close"
            variant="text"
            aria-label="Close library"
            @click="showLibrary = false"
          />
        </VCardTitle>
        <VCardText class="pa-0"><ProjectLibrary :project-id="projectId" /></VCardText>
      </VCard>
    </VDialog>
    <VTextField
      v-if="libraryStore"
      v-model="libraryStore.library.search"
      class="search"
      variant="outlined"
      density="compact"
      placeholder="Search components"
      hide-details
    />

    <VSelect
      v-model="libraryStore.library.packageFilter"
      :items="packageOptions"
      label="Packages"
      multiple
      chips
      closable-chips
      clearable
      density="compact"
      hide-details
    />
    <VSelect
      v-model="libraryStore.library.sourceFilter"
      :items="[{ title: 'Packages', value: 'package' }, { title: 'Local overlay', value: 'local' }, { title: 'Virtual', value: 'virtual' }]"
      label="Sources"
      multiple
      chips
      closable-chips
      clearable
      density="compact"
      hide-details
    />

    <div class="d-flex flex-column align-center gr-4 component-list-container">
      <div
        v-for="[ category, components ] in componentsByCategory"
        :key="category"
        class="d-flex flex-column gr-4"
      >
        <div class="text-uppercase text-disabled">{{ category }} ({{ components.length }})</div>

        <ComponentTemplate
          v-for="componentGroup in components"
          :key="componentGroup.baseName"
          :components="componentGroup.components"
          :sources="libraryStore.library.catalog?.sources"
        />
      </div>

      <div v-if="componentGroupCount === 0" class="text-center text-uppercase text-disabled">
        No components found
      </div>
    </div>

    <div v-if="componentGroupCount > 0" class="mb-2 text-center text-uppercase text-disabled">
      Found {{ componentGroupCount }} component(s)
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
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
}
</style>
