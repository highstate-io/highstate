import { router } from "./trpc"
import { stateRouter } from "./routers/state"
import { projectRouter } from "./routers/project"
import { libraryRouter } from "./routers/library"
import { workspaceRouter } from "./routers/workspace"
import { terminalRouter } from "./routers/terminal"
import { operationRouter } from "./routers/operation"
import { logsRouter } from "./routers/logs"
import { settingsRouter } from "./routers/settings"

export const appRouter = router({
  state: stateRouter,
  project: projectRouter,
  settings: settingsRouter,
  library: libraryRouter,
  workspace: workspaceRouter,
  terminal: terminalRouter,
  operation: operationRouter,
  logs: logsRouter,
})

export type AppRouter = typeof appRouter
