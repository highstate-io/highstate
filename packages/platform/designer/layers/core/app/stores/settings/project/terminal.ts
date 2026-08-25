export const useProjectTerminalSettingsStore = defineMultiStore({
  name: "project-terminal-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/terminals`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.terminalSettings.query.query({ projectId, query })
      })

      return {
        items,
        get: async (terminalId: string) => {
          return await $client.terminalSettings.get.query({ projectId, terminalId })
        },
        sessions: (terminalId: string) => {
          return useCollectionQuery(query => {
            return $client.terminalSettings.querySessions.query({ projectId, terminalId, query })
          })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.terminalSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.terminalSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
        forArtifact: (artifactId: string) => {
          return useCollectionQuery(query => {
            return $client.terminalSettings.query.query({
              projectId,
              query: { ...query, artifactId },
            })
          })
        },
      }
    }),
})
