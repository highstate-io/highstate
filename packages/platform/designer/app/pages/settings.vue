<script setup lang="ts">
import type { RouteMap } from "vue-router"
import { ProjectTabWrapper } from "#layers/core/app/features/shared"

definePageMeta({
  name: "settings",
  panel: {
    title: "Data & Settings",
    icon: "mdi-database-cog",
    closable: true,
  },
})

const projectsStore = useProjectsStore()

const router = useRouter()
const currentRoute = shallowRef<any | null>(null)

watch(
  router.currentRoute,
  async newRoute => {
    // always store the last route on the settings panel
    if (newRoute.path.startsWith("/settings/")) {
      globalLogger.info(
        {
          from: currentRoute.value?.path,
          to: newRoute.path,
        },
        "settings route changed",
      )

      currentRoute.value = newRoute
    }

    if (newRoute?.name === "settings") {
      // redirect to the first global tab if no specific route is selected
      await navigateToTab(tabs.value.beforeGlobalTabs[0])
    }
  },
  { immediate: true },
)

type Tab = {
  name: string
  icon: string
  label: string
  order: number
  isProjectTab: boolean
  subpages: string[]
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
    if (!tabMeta) continue

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

  const beforeGlobalTabs = globalTabs.filter(tab => tab.order < 90)
  const afterGlobalTabs = globalTabs.filter(tab => tab.order >= 90)

  return {
    beforeGlobalTabs,
    projectTabs,
    afterGlobalTabs,
  }
})

const isTabActive = (tab: Tab) => {
  return (
    currentRoute.value &&
    (tab.name === currentRoute.value.name || tab.subpages.includes(currentRoute.value.name))
  )
}

const currentTab = computed(() => {
  return tabs.value.beforeGlobalTabs.find(isTabActive) || tabs.value.projectTabs.find(isTabActive)
})

const navigateToTab = async (tab: Tab) => {
  if (!tab.isProjectTab) {
    await navigateTo({
      name: tab.name as keyof RouteMap,
    })
    return
  }

  await navigateTo({
    name: tab.name as keyof RouteMap,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: { projectId: projectsStore.focusedProjectId } as any,
  })
}

watch(
  () => projectsStore.focusedProjectId,
  async (newProject, oldProject) => {
    const currentRoute = router.currentRoute.value

    if (
      !currentRoute ||
      (newProject === oldProject && currentRoute.path.startsWith("/settings/projects/")) ||
      !currentRoute.path.startsWith("/settings/")
    ) {
      // ignore when already in a project-specific route or not in settings
      return
    }

    if (newProject && tabs.value.projectTabs.length > 0) {
      // navigate to the same tab in new project or to the first project tab
      await navigateToTab(currentTab.value ?? tabs.value.projectTabs[0])
    } else if (!newProject && currentRoute.path.startsWith("/settings/projects/")) {
      // navigate back to overview if project is deselected
      await navigateToTab(tabs.value.beforeGlobalTabs[0])
    }
  },
)
</script>

<template>
  <div class="data-settings-panel">
    <div class="panel-layout">
      <!-- Left vertical tab menu -->
      <div class="vertical-tabs">
        <!-- Global Settings Section -->
        <div class="tab-section">
          <VBtn
            v-for="tab in tabs.beforeGlobalTabs"
            :key="tab.name"
            variant="text"
            :class="['tab-item', { active: isTabActive(tab) }]"
            @click="navigateToTab(tab)"
          >
            <VIcon class="tab-icon">{{ tab.icon }}</VIcon>
            <span class="tab-label">{{ tab.label }}</span>
          </VBtn>
        </div>

        <VDivider class="section-divider" />

        <!-- Project Selection -->
        <div class="tab-section">
          <VSelect
            v-model="projectsStore.focusedProjectId"
            :items="projectsStore.projects"
            label="Project"
            item-title="meta.title"
            item-value="id"
            variant="outlined"
            density="compact"
            class="project-selector"
            prepend-inner-icon="mdi-folder-outline"
            clearable
            hide-details
          />

          <!-- Project-specific tabs (only visible when project is selected) -->
          <template v-if="projectsStore.focusedProjectId">
            <VBtn
              v-for="tab in tabs.projectTabs"
              :key="tab.name"
              variant="text"
              :class="['tab-item', { active: isTabActive(tab) }]"
              @click="navigateToTab(tab)"
            >
              <VIcon class="tab-icon">{{ tab.icon }}</VIcon>
              <span class="tab-label">{{ tab.label }}</span>
            </VBtn>
          </template>
        </div>

        <VDivider class="section-divider" />

        <!-- Additional Global Settings Section -->
        <div class="tab-section">
          <VBtn
            v-for="tab in tabs.afterGlobalTabs"
            :key="tab.name"
            variant="text"
            :class="['tab-item', { active: isTabActive(tab) }]"
            @click="navigateToTab(tab)"
          >
            <VIcon class="tab-icon">{{ tab.icon }}</VIcon>
            <span class="tab-label">{{ tab.label }}</span>
          </VBtn>
        </div>
      </div>

      <!-- Right content area -->
      <div class="content-area">
        <VCard class="content-card" variant="flat">
          <VCardText class="content-card-text">
            <RouterView v-if="currentRoute" :route="currentRoute">
              <template #default="{ Component }">
                <Suspense v-if="(currentRoute.params as any).projectId">
                  <ProjectTabWrapper
                    :project-id="(currentRoute.params as any).projectId"
                    :key="(currentRoute.params as any).projectId"
                  >
                    <component :is="Component" :params="currentRoute.params" />
                  </ProjectTabWrapper>
                </Suspense>
                <component :is="Component" v-else />
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
}

.tab-section {
  margin-bottom: 16px;
}

.section-divider {
  margin: 16px 0;
}

.tab-item {
  width: 100%;
  justify-content: flex-start;
  margin-bottom: 4px;
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

.project-selector {
  margin-bottom: 16px;
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
