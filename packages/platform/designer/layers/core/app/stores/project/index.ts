import { useProjectStore } from "./project"
import { useProjectInstancesStore } from "./instances"
import { useProjectOperationsStore } from "./operations"
import { useProjectStateStore } from "./state"
import { useProjectInfoStore } from "./info"
import { useProjectLibraryStore } from "./library"
import { useProjectValidationStore } from "./validation"
import {
  useProjectApiKeySettingsStore,
  useProjectArtifactSettingsStore,
  useProjectEntitySettingsStore,
  useProjectOperationSettingsStore,
  useProjectPageSettingsStore,
  useProjectPanelSettingsStore,
  useProjectRoleSettingsStore,
  useProjectSecretSettingsStore,
  useProjectServiceAccountSettingsStore,
  useProjectTerminalSettingsStore,
  useProjectTriggerSettingsStore,
  useProjectUnlockMethodSettingsStore,
  useProjectWorkerSettingsStore,
} from "../settings/project"

export function useProjectStores() {
  return {
    infoStore: useProjectInfoStore(),
    libraryStore: useProjectLibraryStore(),
    instancesStore: useProjectInstancesStore(),
    stateStore: useProjectStateStore(),
    validationStore: useProjectValidationStore(),
    operationsStore: useProjectOperationsStore(),
    projectStore: useProjectStore(),
  }
}

export type ProjectInfoStore = ReturnType<typeof useProjectInfoStore>
export type ProjectLibraryStore = ReturnType<typeof useProjectLibraryStore>
export type ProjectStore = ReturnType<typeof useProjectStore>
export type ProjectInstancesStore = ReturnType<typeof useProjectInstancesStore>
export type ProjectOperationsStore = ReturnType<typeof useProjectOperationsStore>
export type ProjectStateStore = ReturnType<typeof useProjectStateStore>
export type ProjectValidationStore = ReturnType<typeof useProjectValidationStore>
export type ProjectStores = ReturnType<typeof useProjectStores>

export function useExplicitProjectStores(projectId: string) {
  return {
    infoStore: useProjectInfoStore(projectId),
    libraryStore: useProjectLibraryStore(projectId),
    instancesStore: useProjectInstancesStore(projectId),
    stateStore: useProjectStateStore(projectId),
    validationStore: useProjectValidationStore(projectId),
    operationsStore: useProjectOperationsStore(projectId),
    projectStore: useProjectStore(projectId),
  }
}

export function ensureProjectStoresCreated(projectId: string) {
  useProjectApiKeySettingsStore.ensureCreated(projectId)
  useProjectArtifactSettingsStore.ensureCreated(projectId)
  useProjectEntitySettingsStore.ensureCreated(projectId)
  useProjectOperationSettingsStore.ensureCreated(projectId)
  useProjectPageSettingsStore.ensureCreated(projectId)
  useProjectPanelSettingsStore.ensureCreated(projectId)
  useProjectRoleSettingsStore.ensureCreated(projectId)
  useProjectSecretSettingsStore.ensureCreated(projectId)
  useProjectServiceAccountSettingsStore.ensureCreated(projectId)
  useProjectTerminalSettingsStore.ensureCreated(projectId)
  useProjectTriggerSettingsStore.ensureCreated(projectId)
  useProjectUnlockMethodSettingsStore.ensureCreated(projectId)
  useProjectWorkerSettingsStore.ensureCreated(projectId)

  return {
    infoStore: useProjectInfoStore.ensureCreated(projectId),
    libraryStore: useProjectLibraryStore.ensureCreated(projectId),
    instancesStore: useProjectInstancesStore.ensureCreated(projectId),
    stateStore: useProjectStateStore.ensureCreated(projectId),
    validationStore: useProjectValidationStore.ensureCreated(projectId),
    operationsStore: useProjectOperationsStore.ensureCreated(projectId),
    projectStore: useProjectStore.ensureCreated(projectId),
  }
}
