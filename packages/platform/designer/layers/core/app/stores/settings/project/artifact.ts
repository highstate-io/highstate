export const useProjectArtifactSettingsStore = defineMultiStore({
  name: "project-artifact-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/artifacts`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.artifactSettings.query.query({ projectId, query })
        }),
        get: async (artifactId: string) => {
          return await $client.artifactSettings.get.query({ projectId, artifactId })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.artifactSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.artifactSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
        forTerminal: (terminalId: string) => {
          return useCollectionQuery(query => {
            return $client.artifactSettings.query.query({
              projectId,
              query: { ...query, terminalId },
            })
          })
        },
        forPage: (pageId: string) => {
          return useCollectionQuery(query => {
            return $client.artifactSettings.query.query({ projectId, query: { ...query, pageId } })
          })
        },
      }
    }),
})
