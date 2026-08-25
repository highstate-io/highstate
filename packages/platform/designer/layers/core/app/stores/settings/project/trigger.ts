export const useProjectTriggerSettingsStore = defineMultiStore({
  name: "project-trigger-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/triggers`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.triggerSettings.query.query({ projectId, query })
        }),
        get: async (triggerId: string) => {
          return await $client.triggerSettings.get.query({ projectId, triggerId })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.triggerSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
      }
    }),
})
