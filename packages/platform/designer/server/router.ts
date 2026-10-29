import { apiKeyRouter } from "./routers/api-key"
import { libraryRouter } from "./routers/library"
import { logsRouter } from "./routers/logs"
import { operationRouter } from "./routers/operation"
import { projectRouter } from "./routers/project"
import { searchRouter } from "./routers/search"
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
  runtimeSettingsRouter,
  secretSettingsRouter,
  terminalSettingsRouter,
  triggerSettingsRouter,
  unlockMethodSettingsRouter,
  workerSettingsRouter,
} from "./routers/settings"
import { stateRouter } from "./routers/state"
import { terminalRouter } from "./routers/terminal"
import { workerRouter } from "./routers/worker"
import { workspaceRouter } from "./routers/workspace"
import { router } from "./trpc"

export const appRouter = router({
  apiKey: apiKeyRouter,
  worker: workerRouter,
  backendApiKeySettings: backendApiKeySettingsRouter,
  backendRoleSettings: backendRoleSettingsRouter,
  backendServiceAccountSettings: backendServiceAccountSettingsRouter,
  runtimeSettings: runtimeSettingsRouter,
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
