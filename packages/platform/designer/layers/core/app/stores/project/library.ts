import { useProjectInfoStore } from "./info"

export const useProjectLibraryStore = defineMultiStore({
  name: "project-library",
  getStoreId: (projectId: string) => `projects/${projectId}/library`,

  create: ({ storeId, id: [projectId], logger }) => {
    return defineStore(storeId, () => {
      const projectInfoStore = useProjectInfoStore(projectId)

      const initialized = ref(false)
      const loading = ref(false)
      const libraryStore: Ref<ReturnType<typeof useLibraryStore> | null> = ref(null)

      const initialize = async () => {
        loading.value = true

        try {
          logger.debug(
            { projectId, libraryId: projectInfoStore.projectInfo.libraryId },
            "initializing project library store",
          )

          libraryStore.value = useLibraryStore.ensureCreated(
            projectInfoStore.projectInfo.libraryId ?? "local",
          )
          await libraryStore.value.initialize()
          initialized.value = true
        } finally {
          loading.value = false
        }
      }

      const addLibraryRoot = () => {
        useLibraryStore.ensureCreated(projectInfoStore.projectInfo.libraryId ?? "local")
      }

      return {
        library: computed(() => {
          if (!libraryStore.value) {
            throw new Error("Library store not initialized")
          }

          return libraryStore.value
        }),

        addLibraryRoot,
        initialized: readonly(initialized),
        loading: readonly(loading),
        initialize,
      }
    })
  },
})
