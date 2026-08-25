export const useProjectOperationSettingsStore = defineMultiStore({
  name: "project-operation-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/operations`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.operationSettings.query.query({ projectId, query })
        }),
        get: async (operationId: string) => {
          return await $client.operationSettings.get.query({ projectId, operationId })
        },
      }
    }),
})
