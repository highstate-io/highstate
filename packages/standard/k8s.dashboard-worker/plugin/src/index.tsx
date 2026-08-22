import {
  ReactRouter,
  registerClusterChooser,
  registerHomeSidebarEntryFilter,
  registerRoute,
} from "@kinvolk/headlamp-plugin/lib"

registerClusterChooser(null)
registerHomeSidebarEntryFilter(entry => (entry.name === "settings" ? null : entry))
registerRoute({
  component: () => <ReactRouter.Redirect to="/" />,
  exact: true,
  name: "Login",
  noAuthRequired: true,
  path: "/login",
  sidebar: null,
})
