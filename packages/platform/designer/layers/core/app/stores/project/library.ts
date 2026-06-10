import { useProjectInfoStore } from "./info"
import type { ComponentModel } from "@highstate/contract"

export const useProjectLibraryStore = defineMultiStore({
  name: "project-library",
  getStoreId: (projectId: string) => `projects/${projectId}/library`,

  create: ({ storeId, id: [projectId], logger }) => {
    return defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const projectInfoStore = useProjectInfoStore(projectId)
      const projectsStore = useProjectsStore()

      const initialized = ref(false)
      const loading = ref(false)
      const libraryStore: Ref<ReturnType<typeof useLibraryStore> | null> = ref(null)
      const virtualComponents = shallowReactive(new Map<string, ComponentModel>())

      const refreshVirtualComponents = async () => {
        const loadedVirtualComponents = await $client.library.getProjectVirtualComponents.query({
          projectId,
        })

        const existingTypes = new Set(virtualComponents.keys())
        for (const [type, component] of Object.entries(loadedVirtualComponents)) {
          virtualComponents.set(type, component)
          existingTypes.delete(type)
        }

        for (const type of existingTypes) {
          virtualComponents.delete(type)
        }
      }

      const mergedComponents = computed<Record<string, ComponentModel>>(() => {
        if (!libraryStore.value) {
          return {}
        }

        return {
          ...libraryStore.value.components,
          ...Object.fromEntries(virtualComponents.entries()),
        }
      })

      const mergedFilteredComponents = computed<ComponentModel[]>(() => {
        if (!libraryStore.value) {
          return []
        }

        const search = String(libraryStore.value.search ?? "").toLowerCase()
        const allComponents = Object.values(mergedComponents.value)

        if (!search) {
          return allComponents
        }

        return allComponents.filter(component => {
          const searchable = `${component.type} ${component.meta.title} ${component.meta.description ?? ""} ${component.meta.category ?? ""}`

          return searchable.toLowerCase().includes(search)
        })
      })

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
          await refreshVirtualComponents()
          initialized.value = true
        } finally {
          loading.value = false
        }
      }

      watch(
        () => projectsStore.projects.map(project => project.id).sort().join("|"),
        () => {
          if (!initialized.value || loading.value) {
            return
          }

          void refreshVirtualComponents()
        },
      )

      const addLibraryRoot = () => {
        useLibraryStore.ensureCreated(projectInfoStore.projectInfo.libraryId ?? "local")
      }

      return {
        library: computed(() => {
          if (!libraryStore.value) {
            throw new Error("Library store not initialized")
          }

          return {
            ...libraryStore.value,
            get search() {
              return libraryStore.value!.search
            },
            set search(value: string) {
              libraryStore.value!.search = value
            },
            components: mergedComponents.value,
            filteredComponents: mergedFilteredComponents.value,
          }
        }),

        components: mergedComponents,

        addLibraryRoot,
        initialized: readonly(initialized),
        loading: readonly(loading),
        initialize,
      }
    })
  },
})
