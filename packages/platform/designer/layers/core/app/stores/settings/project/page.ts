export const useProjectPageSettingsStore = defineMultiStore({
  name: "project-page-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/pages`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.pageSettings.query.query({ projectId, query })
        }),
        get: async (pageId: string) => {
          return await $client.pageSettings.get.query({ projectId, pageId })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.pageSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.pageSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
        forArtifact: (artifactId: string) => {
          return useCollectionQuery(query => {
            return $client.pageSettings.query.query({ projectId, query: { ...query, artifactId } })
          })
        },
      }
    }),
})
