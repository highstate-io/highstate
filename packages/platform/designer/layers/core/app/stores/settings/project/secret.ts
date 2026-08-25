export const useProjectSecretSettingsStore = defineMultiStore({
  name: "project-secret-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/secrets`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.secretSettings.query.query({ projectId, query })
        }),
        get: async (secretId: string) => {
          return await $client.secretSettings.get.query({ projectId, secretId })
        },
        getValue: async (secretId: string) => {
          return await $client.secretSettings.getValue.query({ projectId, secretId })
        },
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.secretSettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        forState: (stateId: string) => {
          return useCollectionQuery(query => {
            return $client.secretSettings.query.query({ projectId, query: { ...query, stateId } })
          })
        },
      }
    }),
})
