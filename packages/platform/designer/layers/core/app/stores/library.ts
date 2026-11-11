import type { ProjectLibraryCatalog, ProjectLibraryDto } from "@highstate/backend"
import type { ComponentModel, EntityModel } from "@highstate/contract"

export const useLibraryStore = defineMultiStore({
  name: "library",
  getStoreId: (projectId: string) => `projects/${projectId}/catalog`,

  create: ({ storeId, id: [projectId], logger, onDeactivated }) => {
    return defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const components = shallowReactive<Record<string, ComponentModel>>({})
      const entities = shallowReactive<Record<string, EntityModel>>({})
      const catalog = shallowRef<ProjectLibraryCatalog>()
      const projectLibrary = shallowRef<ProjectLibraryDto>()
      const unitSourceHashes = shallowReactive(new Map<string, number>())
      const isInitialized = ref(false)
      const isReloading = ref(false)
      const busy = ref(false)
      const error = ref<string>()
      const search = ref("")
      const packageFilter = ref<string[]>([])
      const sourceFilter = ref<string[]>([])

      const { on: onComponentUpdated, trigger: componentUpdated } =
        createEventHook<ComponentModel>()

      const { on: onComponentRemoved, trigger: componentRemoved } = createEventHook<string>()
      const { on: onEntityUpdated, trigger: entityUpdated } = createEventHook<EntityModel>()
      const { on: onEntityRemoved, trigger: entityRemoved } = createEventHook<string>()

      const { on: onUnitSourceHashChanged, trigger: hashChanged } = createEventHook<{
        unitType: string
        sourceHash: number
      }>()

      const ensureUnitSourceHashesLoaded = async (unitTypes: string[], trigger = false) => {
        const types = unitTypes.filter(type => !unitSourceHashes.has(type) && components[type])
        if (!types.length) {
          return
        }

        const hashes = await $client.library.getUnitSourceHashes.query({
          projectId,
          unitTypes: types,
        })

        for (const hash of hashes) {
          unitSourceHashes.set(hash.unitType, hash.sourceHash)

          if (trigger) {
            void hashChanged(hash)
          }
        }
      }

      let refreshing: Promise<void> | undefined

      const refresh = (): Promise<void> => {
        if (refreshing) {
          return refreshing
        }

        refreshing = (async () => {
          const [next, state] = await Promise.all([
            $client.library.get.query({ projectId }),
            $client.library.getProjectLibrary.query({ projectId }),
          ])

          const changed = JSON.stringify(catalog.value) !== JSON.stringify(next)
          if (changed) {
            isReloading.value = true

            for (const type of Object.keys(components)) {
              if (!next.model.components[type]) {
                delete components[type]
                void componentRemoved(type)
              }
            }

            for (const [type, component] of Object.entries(next.model.components)) {
              if (JSON.stringify(components[type]) !== JSON.stringify(component)) {
                components[type] = component
                void componentUpdated(component)
              }
            }

            for (const type of Object.keys(entities)) {
              if (!next.model.entities[type]) {
                delete entities[type]
                void entityRemoved(type)
              }
            }

            for (const [type, entity] of Object.entries(next.model.entities)) {
              if (JSON.stringify(entities[type]) !== JSON.stringify(entity)) {
                entities[type] = entity
                void entityUpdated(entity)
              }
            }

            const previousHashes = new Map(unitSourceHashes)
            unitSourceHashes.clear()
            await ensureUnitSourceHashesLoaded([...previousHashes.keys()])

            for (const [unitType, sourceHash] of unitSourceHashes) {
              if (previousHashes.get(unitType) !== sourceHash) {
                void hashChanged({ unitType, sourceHash })
              }
            }

            catalog.value = next
          }

          projectLibrary.value = state
        })().finally(() => {
          refreshing = undefined
          isReloading.value = false
        })

        return refreshing
      }

      const { pause, resume } = useIntervalFn(
        () => {
          void refresh().catch(cause => {
            logger.warn({ error: cause, projectId }, "failed to refresh project catalog")
            error.value = cause instanceof Error ? cause.message : "Catalog refresh failed"
          })
        },
        3000,
        { immediate: false },
      )

      onDeactivated(pause)

      const initialize = async () => {
        if (isInitialized.value) {
          return
        }

        await refresh()
        isInitialized.value = true
        resume()
      }

      const mutate = async (operation: () => Promise<unknown>) => {
        if (busy.value) {
          return false
        }

        busy.value = true
        error.value = undefined

        try {
          await operation()
          return true
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : "Library change failed"
          return false
        } finally {
          try {
            // a poll already in flight may predate the mutation
            await refreshing
            await refresh()
          } catch (cause) {
            error.value = cause instanceof Error ? cause.message : "Catalog refresh failed"
          }

          busy.value = false
        }
      }

      const matchesFilters = (component: ComponentModel) => {
        const source = catalog.value?.sources[`components:${component.type}`]
        return (
          (!sourceFilter.value.length || (source && sourceFilter.value.includes(source.kind))) &&
          (!packageFilter.value.length ||
            (source?.kind === "package" && packageFilter.value.includes(source.packageName)))
        )
      }

      const filteredComponents = computed(() =>
        Object.values(components).filter(component => {
          const text = `${component.type} ${component.meta.title} ${component.meta.description ?? ""} ${component.meta.category ?? ""}`
          return (
            matchesFilters(component) && text.toLowerCase().includes(search.value.toLowerCase())
          )
        }),
      )

      return {
        projectId,
        components,
        entities,
        catalog,
        projectLibrary,
        unitSourceHashes,
        isInitialized,
        isReloading,
        busy,
        error,
        search,
        packageFilter,
        sourceFilter,
        filteredComponents,
        matchesFilters,
        initialize,
        refresh,
        ensureUnitSourceHashesLoaded,
        onComponentUpdated,
        onComponentRemoved,
        onEntityUpdated,
        onEntityRemoved,
        onUnitSourceHashChanged,
        addPackage: (packageName: string, version: string) =>
          mutate(() => $client.library.addPackage.mutate({ projectId, packageName, version })),
        updatePackage: (packageName: string, version?: string) =>
          mutate(() => $client.library.updatePackage.mutate({ projectId, packageName, version })),
        removePackage: (packageName: string) =>
          mutate(() => $client.library.removePackage.mutate({ projectId, packageName })),
        updateAll: () => mutate(() => $client.library.updateAll.mutate({ projectId })),
        setLocalOverlay: (enabled: boolean) =>
          mutate(() => $client.library.setLocalOverlay.mutate({ projectId, enabled })),
        retryDesiredImage: () =>
          mutate(() => $client.library.retryDesiredImage.mutate({ projectId })),
        listPackageVersions: async (packageName: string) =>
          await $client.library.listPackageVersions.query({ projectId, packageName }),
      }
    })
  },
})

export type LibraryStore = ReturnType<typeof useLibraryStore>
