export const useProjectWorkerSettingsStore = defineMultiStore({
  name: "project-worker-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/workers`,
  create: ({ storeId, id: [projectId], onDeactivated }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.workerSettings.query.query({ projectId, query })
      })
      const activeVersionQueries = shallowReactive(new Set<{ load: () => Promise<void> }>())
      let reloadTimeout: ReturnType<typeof setTimeout> | undefined
      const refresh = async () => {
        return await Promise.allSettled([
          items.load(),
          ...Array.from(activeVersionQueries).map(query => query.load()),
        ])
      }
      const { unsubscribe } = $client.worker.watchVersionStatuses.subscribe(
        { projectId },
        {
          onData() {
            if (reloadTimeout) return
            reloadTimeout = setTimeout(() => {
              reloadTimeout = undefined
              void refresh()
            }, 250)
          },
        },
      )
      onDeactivated(() => {
        if (reloadTimeout) clearTimeout(reloadTimeout)
        unsubscribe()
      })
      return {
        items,
        get: async (workerId: string) => {
          return await $client.workerSettings.get.query({ projectId, workerId })
        },
        getVersion: async (versionId: string) => {
          return await $client.workerSettings.getVersion.query({ projectId, versionId })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.workerSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        versions: (workerId: string) => {
          const state = useCollectionQuery(query => {
            return $client.workerSettings.queryVersions.query({ projectId, workerId, query })
          })
          activeVersionQueries.add(state)
          onDeactivated(() => activeVersionQueries.delete(state))
          return state
        },
        refresh,
      }
    }),
})
