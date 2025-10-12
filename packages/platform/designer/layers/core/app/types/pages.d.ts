import type { RouteLocationNormalizedGeneric } from "vue-router"
import type { AddPanelOptions } from "dockview-core"

declare module "#app" {
  interface PageMeta {
    /**
     * Unique panel identifier.
     * If not specified, the route name will be used.
     */
    panelId?: string | ((route: RouteLocationNormalizedGeneric) => string)

    /**
     * Panel configuration for this page.
     * Can be a static object or a function that receives the route and returns panel config.
     * If function returns a promise, it will be awaited.
     */
    panel?:
      | Highstate.PanelConfig
      | ((
          route: RouteLocationNormalizedGeneric,
        ) => Highstate.PanelConfig | Promise<Highstate.PanelConfig>)

    /**
     * Tab configuration for pages that appear as tabs in a parent panel.
     * Used for settings pages and other sub-navigation.
     */
    tab?: Highstate.TabConfig
  }
}

declare namespace Highstate {
  interface TabConfig {
    /**
     * The label for the tab.
     */
    label: string

    /**
     * The material design icon to use for the tab.
     */
    icon: string

    /**
     * Sorting order of the tab.
     * Lower numbers appear first.
     */
    order?: number

    /**
     * The names of subpages that belong to this tab and should keep the tab active when navigated to.
     */
    subpages?: string[]
  }

  type PanelConfig = {
    /**
     * The title of the panel.
     * This will be displayed in the tab header.
     */
    title: string

    /**
     * Whether to use the stored title from the panel if available.
     * Should be set when the provided title is fallback.
     */
    preferStoredTitle?: boolean

    /**
     * The iconify icon to use for the panel.
     * Will replace the default icon if provided.
     */
    customIcon?: string

    /**
     * The material design icon to use for the panel.
     */
    icon?: string

    /**
     * Whether the panel can be closed by the user.
     */
    closable?: boolean

    /**
     * Whether the panel should be focusable and navigable.
     */
    focusable?: boolean
  } & Pick<
    AddPanelOptions,
    | "position"
    | "initialHeight"
    | "initialWidth"
    | "minimumHeight"
    | "minimumWidth"
    | "maximumHeight"
    | "maximumWidth"
  >
}
