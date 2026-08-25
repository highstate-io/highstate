export const useProjectPanelSettingsStore = defineMultiStore({
  name: "project-panel-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/panels`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.panelSettings.query.query({ projectId, query })
      })

      return {
        items,
        get: async (panelId: string) => {
          return await $client.panelSettings.get.query({ projectId, panelId })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.panelSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.panelSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
        forWorkerVersion: (workerVersionId: string) => {
          return useCollectionQuery(query => {
            return $client.panelSettings.query.query({
              projectId,
              query: { ...query, workerVersionId },
            })
          })
        },
      }
    }),
})
