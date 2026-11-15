<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from "vue-router"
import { ProjectTabWrapper } from "#layers/core/app/features/shared"
import { routeAccess } from "#layers/core/app/utils/access-policy"

definePageMeta({
  name: "settings",
  middleware: to => {
    if (to.name === "settings") {
      return navigateTo({ name: "settings.project-list" })
    }
  },
  panel: {
    title: "Data & Settings",
    icon: "mdi-database-cog",
    closable: true,
  },
})

const projectsStore = useProjectsStore()

const router = useRouter()
const currentRoute = shallowRef<RouteLocationNormalizedLoaded | null>(null)
const selectedProjectId = ref<string | null>(projectsStore.focusedProjectId)
const lastBackendTab = ref<string>()
const lastProjectTab = ref<string>()

const scope = computed(() =>
  currentRoute.value?.path.startsWith("/settings/projects/") ? "project" : "backend",
)

type Tab = {
  name: string
  icon: string
  label: string
  order: number
  isProjectTab: boolean
  subpages: string[]
  group?: "Runtime" | "Resources" | "Security"
}

/**
 * Generate tabs dynamically from settings routes using their meta.tab
 */
const tabs = computed(() => {
  const allRoutes = router.getRoutes()

  const settingsRoutes = allRoutes.filter(
    r => r.path.startsWith("/settings/") && r.path !== "/settings" && r.meta?.tab,
  )

  const globalTabs: Tab[] = []
  const projectTabs: Tab[] = []

  for (const route of settingsRoutes) {
    const tabMeta = route.meta.tab
    if (!tabMeta) {
      continue
    }

    if (!route.path.startsWith("/settings/")) {
      // skip non-settings routes
      continue
    }

    const tab = {
      name: route.name as string,
      icon: tabMeta.icon,
      label: tabMeta.label,
      order: tabMeta.order || 50,
      isProjectTab: route.path.startsWith("/settings/projects/"),
      subpages: tabMeta.subpages ?? [],
      group: tabMeta.group,
    }

    if (tab.isProjectTab) {
      projectTabs.push(tab)
    } else {
      globalTabs.push(tab)
    }
  }

  // sort tabs by order
  globalTabs.sort((a, b) => a.order - b.order)
  projectTabs.sort((a, b) => a.order - b.order)

  const projectGroups = [
    { label: undefined, tabs: projectTabs.filter(tab => !tab.group) },
    { label: "Resources", tabs: projectTabs.filter(tab => tab.group === "Resources") },
    { label: "Runtime", tabs: projectTabs.filter(tab => tab.group === "Runtime") },
    { label: "Security", tabs: projectTabs.filter(tab => tab.group === "Security") },
  ].filter(group => group.tabs.length)

  return {
    globalTabs,
    globalGroups: [
      { label: undefined, tabs: globalTabs.filter(tab => !tab.group) },
      { label: "Runtime", tabs: globalTabs.filter(tab => tab.group === "Runtime") },
      { label: "Security", tabs: globalTabs.filter(tab => tab.group === "Security") },
    ].filter(group => group.tabs.length),
    projectTabs: projectGroups.flatMap(group => group.tabs),
    projectGroups,
  }
})

const isTabActive = (tab: Tab) => {
  return (
    currentRoute.value &&
    (tab.name === currentRoute.value.name || tab.subpages.includes(String(currentRoute.value.name)))
  )
}

const currentTab = computed(() => {
  return [...tabs.value.globalTabs, ...tabs.value.projectTabs].find(isTabActive)
})

const navigateToTab = async (tab: Tab) => {
  if (!tab.isProjectTab) {
    await navigateTo({ name: tab.name })
    return
  }

  if (!selectedProjectId.value) {
    return
  }

  await navigateTo({
    name: tab.name,
    params: { projectId: selectedProjectId.value },
  })
}

async function switchScope(value: unknown) {
  if (value !== "backend" && value !== "project") {
    return
  }

  if (value === scope.value || (value === "project" && !projectsStore.projects.length)) {
    return
  }

  const available = value === "project" ? tabs.value.projectTabs : tabs.value.globalTabs

  const previous = value === "project" ? lastProjectTab.value : lastBackendTab.value
  const tab = available.find(tab => tab.name === previous) ?? available[0]

  if (tab) {
    await navigateToTab(tab)
  }
}

watch(
  router.currentRoute,
  newRoute => {
    if (newRoute.path.startsWith("/settings/")) {
      currentRoute.value = newRoute

      if (typeof newRoute.params.projectId === "string") {
        selectedProjectId.value = newRoute.params.projectId
      }

      if (scope.value === "project") {
        lastProjectTab.value = currentTab.value?.name
      } else {
        lastBackendTab.value = currentTab.value?.name
      }
    }
  },
  { immediate: true },
)

watch(
  [() => projectsStore.projects, () => projectsStore.projectsLoaded],
  async ([projects, loaded]) => {
    if (!loaded) {
      return
    }

    if (!projects.some(project => project.id === selectedProjectId.value)) {
      selectedProjectId.value =
        projects.find(project => project.id === projectsStore.focusedProjectId)?.id ??
        projects[0]?.id ??
        null
    }

    if (!projects.length && router.currentRoute.value.path.startsWith("/settings/projects/")) {
      await navigateToTab(tabs.value.globalTabs[0])
    }
  },
  { immediate: true },
)

watch(selectedProjectId, async projectId => {
  if (
    !projectId ||
    !router.currentRoute.value.path.startsWith("/settings/projects/") ||
    router.currentRoute.value.params.projectId === projectId
  ) {
    return
  }

  await navigateToTab(currentTab.value?.isProjectTab ? currentTab.value : tabs.value.projectTabs[0])
})
</script>

<template>
  <div class="data-settings-panel">
    <div class="panel-layout">
      <!-- Left vertical tab menu -->
      <div class="vertical-tabs">
        <VBtnToggle
          :model-value="scope"
          mandatory
          divided
          variant="outlined"
          density="compact"
          color="primary"
          aria-label="Settings scope"
          class="scope-switch"
          @update:model-value="switchScope"
        >
          <VBtn value="backend">Backend</VBtn>
          <VBtn value="project" :disabled="!projectsStore.projects.length">Project</VBtn>
        </VBtnToggle>

        <template v-if="scope === 'backend'">
          <!-- Global Settings Section -->
          <template v-for="(group, index) in tabs.globalGroups" :key="group.label ?? 'general'">
            <VDivider v-if="index" class="section-divider" />
            <div
              class="tab-section"
              :role="group.label ? 'group' : undefined"
              :aria-label="group.label"
            >
              <div v-if="group.label" class="tab-group-title text-medium-emphasis">
                {{ group.label }}
              </div>
              <VBtn
                v-for="tab in group.tabs"
                v-access="routeAccess(tab.name)"
                :key="tab.name"
                variant="text"
                :class="['tab-item', { active: isTabActive(tab) }]"
                @click="navigateToTab(tab)"
              >
                <VIcon class="tab-icon">{{ tab.icon }}</VIcon>
                <span class="tab-label">{{ tab.label }}</span>
              </VBtn>
            </div>
          </template>
        </template>

        <template v-else>
          <div class="project-selector-row">
            <VSelect
              v-access="{ permission: 'project.list', collection: true }"
              v-model="selectedProjectId"
              :items="projectsStore.projects"
              label="Project"
              item-title="meta.title"
              item-value="id"
              variant="outlined"
              density="compact"
              class="project-selector"
              prepend-inner-icon="mdi-folder-outline"
              single-line
              hide-details
            />
          </div>

          <VDivider class="section-divider" />

          <template v-for="(group, index) in tabs.projectGroups" :key="group.label ?? 'general'">
            <VDivider v-if="index" class="section-divider" />
            <div
              class="tab-section"
              :role="group.label ? 'group' : undefined"
              :aria-label="group.label"
            >
              <div v-if="group.label" class="tab-group-title text-medium-emphasis">
                {{ group.label }}
              </div>
              <VBtn
                v-for="tab in group.tabs"
                v-access="routeAccess(tab.name, { projectId: selectedProjectId })"
                :key="tab.name"
                variant="text"
                :class="['tab-item', { active: isTabActive(tab) }]"
                @click="navigateToTab(tab)"
              >
                <VIcon class="tab-icon">{{ tab.icon }}</VIcon>
                <span class="tab-label">{{ tab.label }}</span>
              </VBtn>
            </div>
          </template>
        </template>
      </div>

      <!-- Right content area -->
      <div class="content-area">
        <VCard class="content-card" variant="flat">
          <VCardText class="content-card-text">
            <RouterView v-if="currentRoute" :route="currentRoute">
              <template #default="{ Component }">
                <AccessBoundary
                  :panel="!!currentRoute.params.projectId"
                  :requirements="currentRoute.params.projectId || currentRoute.name?.toString().endsWith('-details') ? routeAccess(String(currentRoute.name), currentRoute.params) : []"
                >
                  <Suspense v-if="currentRoute.params.projectId">
                    <ProjectTabWrapper
                      :project-id="String(currentRoute.params.projectId)"
                      :key="String(currentRoute.params.projectId)"
                    >
                      <component :is="Component" :params="currentRoute.params" />
                    </ProjectTabWrapper>
                  </Suspense>
                  <component :is="Component" v-else :params="currentRoute.params" />
                </AccessBoundary>
              </template>
            </RouterView>
          </VCardText>
        </VCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-settings-panel {
  height: 100%;
  width: 100%;
}

.panel-layout {
  display: flex;
  height: 100%;
}

.vertical-tabs {
  width: 280px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.04);
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 16px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.scope-switch {
  width: 100%;
  height: 36px;
  margin-bottom: 12px;
}

.scope-switch :deep(.v-btn) {
  flex: 1;
  min-width: 0;
  text-transform: none;
}

.tab-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-divider {
  margin: 12px 0;
}

.tab-group-title {
  padding: 0 12px;
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tab-item {
  width: 100%;
  height: 40px;
  min-height: 40px;
  justify-content: flex-start;
  padding: 8px 12px;
  border-radius: 8px;
  text-transform: none;
  font-weight: 400;
}

.tab-item.active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.tab-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.tab-item.active:hover {
  background: rgba(var(--v-theme-primary), 0.16);
}

.tab-icon {
  margin-right: 12px;
  font-size: 20px;
}

.tab-label {
  font-size: 14px;
}

.project-selector-row {
  width: 100%;
  height: 40px;
}

.project-selector {
  width: 100%;
  margin: 0;
}

.project-selector :deep(.v-field__input) {
  min-height: 40px;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.content-card {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.content-card-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 24px;
}

.tab-content {
  width: 100%;
}
</style>
