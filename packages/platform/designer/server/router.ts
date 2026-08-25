import { router } from "./trpc"
import { apiKeyRouter } from "./routers/api-key"
import { stateRouter } from "./routers/state"
import { projectRouter } from "./routers/project"
import { libraryRouter } from "./routers/library"
import { workspaceRouter } from "./routers/workspace"
import { terminalRouter } from "./routers/terminal"
import { operationRouter } from "./routers/operation"
import { logsRouter } from "./routers/logs"
import {
  artifactSettingsRouter,
  backendApiKeySettingsRouter,
  backendRoleSettingsRouter,
  backendServiceAccountSettingsRouter,
  entitySettingsRouter,
  operationSettingsRouter,
  pageSettingsRouter,
  panelSettingsRouter,
  projectApiKeySettingsRouter,
  projectRoleSettingsRouter,
  projectServiceAccountSettingsRouter,
  secretSettingsRouter,
  terminalSettingsRouter,
  triggerSettingsRouter,
  unlockMethodSettingsRouter,
  workerSettingsRouter,
} from "./routers/settings"
import { workerRouter } from "./routers/worker"
import { searchRouter } from "./routers/search"

export const appRouter = router({
  apiKey: apiKeyRouter,
  worker: workerRouter,
  backendApiKeySettings: backendApiKeySettingsRouter,
  backendRoleSettings: backendRoleSettingsRouter,
  backendServiceAccountSettings: backendServiceAccountSettingsRouter,
  projectApiKeySettings: projectApiKeySettingsRouter,
  projectRoleSettings: projectRoleSettingsRouter,
  projectServiceAccountSettings: projectServiceAccountSettingsRouter,
  operationSettings: operationSettingsRouter,
  terminalSettings: terminalSettingsRouter,
  pageSettings: pageSettingsRouter,
  panelSettings: panelSettingsRouter,
  secretSettings: secretSettingsRouter,
  triggerSettings: triggerSettingsRouter,
  artifactSettings: artifactSettingsRouter,
  workerSettings: workerSettingsRouter,
  entitySettings: entitySettingsRouter,
  unlockMethodSettings: unlockMethodSettingsRouter,
  state: stateRouter,
  project: projectRouter,
  library: libraryRouter,
  workspace: workspaceRouter,
  terminal: terminalRouter,
  operation: operationRouter,
  logs: logsRouter,
  search: searchRouter,
})

export type AppRouter = typeof appRouter
