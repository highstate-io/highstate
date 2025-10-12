import type { ComponentModel, EntityModel } from "@highstate/contract"
import { Index } from "flexsearch"
import { applyLibraryUpdate, type LibraryUpdate } from "@highstate/backend/shared"

export const useLibraryStore = defineMultiStore({
  name: "library",
  getStoreId: (libraryId: string) => `libraries/${libraryId}`,

  create: ({ storeId, id: [libraryId], logger, onDeactivated }) => {
    return defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      const componentIndex = new Index({ tokenize: "bidirectional" })

      const components = shallowReactive<Record<string, ComponentModel>>({})
      const entities = shallowReactive<Record<string, EntityModel>>({})

      const unitSourceHashes = shallowReactive<Map<string, number>>(new Map())
      const isReloading = ref(false)
      const isInitialized = ref(false)

      const { on: onComponentUpdated, trigger: triggerComponentUpdated } =
        createEventHook<ComponentModel>()
      const { on: onComponentRemoved, trigger: triggerComponentRemoved } = createEventHook<string>()
      const { on: onEntityUpdated, trigger: triggerEntityUpdated } = createEventHook<EntityModel>()
      const { on: onEntityRemoved, trigger: triggerEntityRemoved } = createEventHook<string>()

      const { on: onUnitSourceHashChanged, trigger: triggerUnitSourceHashChanged } =
        createEventHook<{
          unitType: string
          sourceHash: number
        }>()

      const triggerUpdateEvent = (update: LibraryUpdate) => {
        switch (update.type) {
          case "reload-started":
            isReloading.value = true
            break
          case "reload-completed":
            isReloading.value = false
            break
          case "component-updated":
            triggerComponentUpdated(update.component)
            break
          case "component-removed":
            triggerComponentRemoved(update.componentType)
            break
          case "entity-updated":
            triggerEntityUpdated(update.entity)
            break
          case "entity-removed":
            triggerEntityRemoved(update.entityType)
            break
        }
      }

      const addComponentIndex = (component: ComponentModel): void => {
        const content = `${component.type} ${component.meta.title} ${component.meta.description ?? ""} ${component.meta.category ?? ""}`
        void componentIndex.add(component.type, content)
      }

      const updateComponentIndex = async (component: ComponentModel): Promise<void> => {
        await componentIndex.remove(component.type)
        addComponentIndex(component)
      }

      const handleLibraryUpdate = (update: LibraryUpdate): void => {
        applyLibraryUpdate(components, entities, update)
        triggerUpdateEvent(update)

        switch (update.type) {
          case "component-updated":
            void updateComponentIndex(update.component)
            break
          case "component-removed":
            void componentIndex.remove(update.componentType)
            break
        }
      }

      const initialize = async () => {
        if (isInitialized.value) {
          return
        }

        try {
          logger.debug({ libraryId }, "initializing library store")

          const library = await $client.library.get.query({ libraryId })

          Object.assign(components, library.components)
          Object.assign(entities, library.entities)

          for (const component of Object.values(components)) {
            addComponentIndex(component)
          }

          const libraryWatchSubscription = $client.library.watch.subscribe(
            { libraryId },
            {
              onData(updates) {
                for (const update of updates) {
                  handleLibraryUpdate(update as LibraryUpdate)
                }
              },
            },
          )

          const unitHashWatchSubscription = $client.library.watchUnitSourceHashes.subscribe(
            { libraryId },
            {
              onData({ unitType, sourceHash }) {
                const existingSourceHash = unitSourceHashes.get(unitType)
                if (existingSourceHash === sourceHash) {
                  return
                }

                unitSourceHashes.set(unitType, sourceHash)
                triggerUnitSourceHashChanged({ unitType, sourceHash })

                logger.info({ unitType, sourceHash, libraryId }, "unit source hash updated")
              },
            },
          )

          onDeactivated(() => {
            logger.debug({ libraryId }, "cleaning up library store subscriptions")
            libraryWatchSubscription.unsubscribe?.()
            unitHashWatchSubscription.unsubscribe?.()
          })

          isInitialized.value = true
          logger.debug({ libraryId }, "library store initialized successfully")
        } catch (error) {
          logger.error({ error, libraryId }, "failed to initialize library store")
          throw error
        }
      }

      const ensureUnitSourceHashesLoaded = async (unitTypes: string[], trigger = false) => {
        const unitTypesToLoad = unitTypes.filter(unitType => !unitSourceHashes.has(unitType))
        if (unitTypesToLoad.length === 0) {
          return
        }

        const sourceHashes = await $client.library.getUnitSourceHashes.query({
          libraryId,
          unitTypes: unitTypesToLoad,
        })

        for (const { unitType, sourceHash } of sourceHashes) {
          unitSourceHashes.set(unitType, sourceHash)

          if (trigger) {
            triggerUnitSourceHashChanged({ unitType, sourceHash })
          }
        }
      }

      const search = ref("")
      const debouncedSearch = useDebounce(search, 100)

      const filteredComponents = computedAsync<ComponentModel[]>(async () => {
        if (!debouncedSearch.value) {
          return Object.values(components)
        }

        const result = await componentIndex.search(debouncedSearch.value)

        const resultArray = Array.isArray(result) ? result : []
        return resultArray.map(id => components[String(id)]).filter(Boolean)
      }, [])

      return {
        libraryId,
        initialize,
        ensureUnitSourceHashesLoaded,

        components,
        entities,
        isReloading,
        isInitialized,

        onComponentUpdated,
        onComponentRemoved,
        onEntityUpdated,
        onEntityRemoved,

        search,
        filteredComponents,

        unitSourceHashes,
        onUnitSourceHashChanged,
      }
    })
  },
})

export type LibraryStore = ReturnType<typeof useLibraryStore>
