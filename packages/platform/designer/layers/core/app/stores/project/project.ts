import { useProjectInstancesStore } from "./instances"
import { useProjectOperationsStore } from "./operations"
import { useProjectStateStore } from "./state"
import { useProjectLibraryStore } from "./library"
import { useProjectInfoStore } from "./info"
import { useProjectValidationStore } from "./validation"

export const useProjectStore = defineMultiStore({
  name: "project",
  getStoreId: (projectId: string) => `projects/${projectId}`,

  create: ({ storeId, id: [projectId], logger }) => {
    return defineStore(storeId, () => {
      const initialized = ref(false)
      const initializing = ref(false)

      const operationsStore = useProjectOperationsStore(projectId)
      const instancesStore = useProjectInstancesStore(projectId)
      const stateStore = useProjectStateStore(projectId)
      const projectInfoStore = useProjectInfoStore(projectId)
      const libraryStore = useProjectLibraryStore(projectId)
      const validationStore = useProjectValidationStore(projectId)

      // split initialization into to steps to provide the library store vue context
      // every await call loses the vue context and I have not found a way to preserve it
      // the workaround is to call both initialization functions in sequence inside setup()

      const addLibraryRoot = () => {
        libraryStore.addLibraryRoot()
      }

      const initialize1 = async () => {
        if (initializing.value) {
          logger.warn({ projectId }, "initialization is already in progress")
          return
        }

        initializing.value = true

        logger.info({ projectId }, "initializing project store")

        await projectInfoStore.initialize()
      }

      const initialize2 = async () => {
        await libraryStore.initialize()
        await instancesStore.initialize()

        // now we can load the ui
        initialized.value = true

        await Promise.all([
          operationsStore.initialize(),
          instancesStore.postInitialize(),
          stateStore.initialize(),
          validationStore.initialize(),
        ])

        logger.info({ projectId }, "project store initialized")
      }

      return {
        projectId,

        initialized: readonly(initialized),
        initializing: readonly(initializing),

        addLibraryRoot,
        initialize1,
        initialize2,
      }
    })
  },
})
