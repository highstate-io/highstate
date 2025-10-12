/**
 * Router middleware to automatically manage dockview panels based on route navigation.
 * When navigating to a route with panel metadata, it creates or focuses the corresponding panel.
 * Automatically injects route information (name, params) into panel data.
 */

import { pick } from "remeda"
import type { Highstate } from "#layers/core/app/types/pages"
import type { RouteLocationNormalized } from "vue-router"

export default defineNuxtRouteMiddleware(async to => {
  // only run on client side
  if (import.meta.server) return

  const workspaceStore = useWorkspaceStore()
  const projectsStore = useProjectsStore()
  const dockviewApi = workspaceStore.dockview

  if ("projectId" in to.params) {
    // set focused project ID in store if available
    projectsStore.focusedProjectId = to.params.projectId as string
  }

  // ensure dockview is initialized
  if (!dockviewApi) return

  // check if route has panel metadata
  const panelMeta = to.meta.panel
  if (!panelMeta) return

  try {
    // resolve panel config (static object or function result)
    let panelConfig: Highstate.PanelConfig

    if (typeof panelMeta === "function") {
      panelConfig = await panelMeta(to as RouteLocationNormalized)
    } else {
      panelConfig = panelMeta as Highstate.PanelConfig
    }

    const panelId =
      typeof to.meta.panelId === "function"
        ? to.meta.panelId(to as RouteLocationNormalized)
        : (to.meta.panelId ?? (to.name as string)?.split(".")[0])

    if (!panelId) {
      globalLogger.warn("no panelId for route %s", to.fullPath)
      return
    }

    // check if panel already exists
    const existingPanel = dockviewApi.getPanel(panelId)

    const params = {
      // params defined by page meta
      title: panelConfig.title,
      customIcon: panelConfig.customIcon,
      icon: panelConfig.icon,
      closable: panelConfig.closable ?? true,
      focusable: panelConfig.focusable ?? true,

      // store route info for navigation when panel is focused
      routeName: to.name,
      routeParams: to.params,

      // pass route params to panel component
      ...to.params,
    }

    if (existingPanel) {
      globalLogger.debug("focusing existing panel %s for route %s", panelId, to.fullPath)

      if (panelConfig.preferStoredTitle) {
        // use stored title if available
        params.title = existingPanel.params?.title ?? params.title
      }

      // update existing panel with new params
      existingPanel.update({ params })

      // focus existing panel
      existingPanel.focus()
      return
    }

    globalLogger.debug("creating new panel %s for route %s", panelId, to.fullPath)

    // create new panel
    dockviewApi.addPanel({
      id: panelId,
      component: "GenericPanel",
      tabComponent: "CustomTab",

      params,

      ...pick(panelConfig, [
        "position",
        "initialHeight",
        "initialWidth",
        "minimumHeight",
        "minimumWidth",
        "maximumHeight",
        "maximumWidth",
      ]),
    })
  } catch (error) {
    globalLogger.error({ error }, "failed to create panel for route %s", to.fullPath)
  }
})
