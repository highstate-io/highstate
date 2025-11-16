import type { DockviewApi, SerializedDockview } from "dockview-vue"

export const useWorkspaceStore = defineStore("workspace", () => {
  const dockview = markRaw(ref<DockviewApi | null>(null))
  const serializedLayout = markRaw(ref<SerializedDockview | null>(null))

  const projectsStore = useProjectsStore()
  const { $client } = useNuxtApp()

  const router = useRouter()

  const persistLayout = useDebounceFn(async () => {
    const layout = dockview.value!.toJSON()
    serializedLayout.value = layout

    await $client.workspace.setWorkspaceLayout.mutate({ layout })
  }, 1000)

  const populateDefaultLayout = async () => {
    await navigateTo("/dummy")
    await navigateTo({ name: "home" })
    await navigateTo({ name: "components" })
    await navigateTo({ name: "operations" })
    await navigateTo({ name: "home" })
  }

  const init = (api: DockviewApi) => {
    dockview.value = api

    dockview.value.onDidActivePanelChange(panel => {
      if (!panel) {
        projectsStore.focusedProjectId = null
        return
      }

      const route = panel.params?.routeName as string | undefined
      const params = panel.params?.routeParams as Record<string, string> | undefined
      const focusable = panel.params?.focusable ?? true

      if (!route || !params || !focusable) {
        return
      }

      globalLogger.debug(
        "navigating to route %s with params %o for panel %s",
        route,
        params,
        panel.id,
      )

      void navigateTo({
        name: route,
        params: params,
      })
    })

    dockview.value.onDidRemovePanel(panel => {
      if (panel?.params?.projectId === projectsStore.focusedProjectId) {
        projectsStore.focusedProjectId = null
      }
    })

    dockview.value.onDidLayoutChange(persistLayout)
  }

  const loadLayout = async () => {
    const layout = await $client.workspace.getWorkspaceLayout.query()
    const data = layout as SerializedDockview

    if (data && data.panels && Object.keys(data.panels).length > 0) {
      try {
        dockview.value!.fromJSON(data)
        serializedLayout.value = data

        const currentRoute = router.currentRoute.value

        if (currentRoute.name !== "home") {
          // navigate to the route again to switch to the correct panel
          await navigateTo("/dummy")

          await navigateTo({
            name: currentRoute.name,
            params: currentRoute.params,
          })
        }
      } catch (error) {
        globalLogger.error({ error }, "failed to deserialize layout, resetting to default")
        await populateDefaultLayout()
      }
    } else {
      await populateDefaultLayout()
    }
  }

  const resetLayout = async () => {
    dockview.value!.clear()
    await populateDefaultLayout()
    await persistLayout()
  }

  const openProjectPanel = async (projectId: string) => {
    await navigateTo({
      name: "project",
      params: { projectId },
    })
  }

  const openCompositeInstancePanel = async (projectId: string, stateId: string) => {
    await navigateTo({
      name: "composite-instance",
      params: { projectId, stateId },
    })
  }

  const openTerminalPanel = async (projectId: string, sessionId: string) => {
    await navigateTo({
      name: "terminal-session",
      params: { projectId, sessionId },
    })
  }

  const openLogsPanel = async (projectId: string, operationId: string, stateId: string) => {
    await navigateTo({
      name: "instance-logs",
      params: { projectId, operationId, stateId },
    })
  }

  const openWorkerVersionLogsPanel = async (projectId: string, workerVersionId: string) => {
    await navigateTo({
      name: "worker-version-logs",
      params: { projectId, workerVersionId },
    })
  }

  const openDataSettingsPanel = async () => {
    await navigateTo("/settings")
  }

  const closeTerminalPanel = (projectId: string, sessionId: string) => {
    const panel = dockview.value!.getPanel(`projects/${projectId}/terminal-sessions/${sessionId}`)

    if (panel) {
      dockview.value!.removePanel(panel)
    }
  }

  return {
    dockview,
    init,
    loadLayout,
    resetLayout,

    openProjectPanel,
    openCompositeInstancePanel,
    openTerminalPanel,
    closeTerminalPanel,
    openLogsPanel,
    openDataSettingsPanel,
    openWorkerVersionLogsPanel,

    // for debugging
    serializedLayout,
  }
})
