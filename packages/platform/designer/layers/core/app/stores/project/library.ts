export const useProjectLibraryStore = defineMultiStore({
  name: "project-library",
  getStoreId: (projectId: string) => `projects/${projectId}/library`,

  create: ({ storeId, id: [projectId] }) => {
    return defineStore(storeId, () => {
      const libraryStore = shallowRef<LibraryStore>()
      const initialized = ref(false)
      const loading = ref(false)

      const addLibraryRoot = () => {
        libraryStore.value = useLibraryStore.ensureCreated(projectId)
      }

      const initialize = async () => {
        if (initialized.value) {
          return
        }

        loading.value = true

        try {
          libraryStore.value ??= useLibraryStore.ensureCreated(projectId)
          await libraryStore.value!.initialize()
          initialized.value = true
        } finally {
          loading.value = false
        }
      }

      return {
        library: computed(() => {
          if (!libraryStore.value) {
            throw new Error("Library store not initialized")
          }

          return libraryStore.value
        }),
        components: computed(() => libraryStore.value?.components ?? {}),
        addLibraryRoot,
        initialize,
        initialized: readonly(initialized),
        loading: readonly(loading),
        refreshVirtualComponents: async () => {
          await libraryStore.value?.refresh()
        },
      }
    })
  },
})
