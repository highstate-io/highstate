import type { ApiKeyInput } from "@highstate/backend/shared"

export const useProjectApiKeySettingsStore = defineMultiStore({
  name: "project-api-key-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/api-keys`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.projectApiKeySettings.query.query({ projectId, query })
      })

      async function create(apiKey: ApiKeyInput) {
        const result = await $client.projectApiKeySettings.create.mutate({ projectId, apiKey })
        await items.load()

        return result
      }

      async function update(apiKeyId: string, apiKey: ApiKeyInput) {
        const result = await $client.projectApiKeySettings.update.mutate({
          projectId,
          apiKeyId,
          apiKey,
        })
        await items.load()

        return result
      }

      async function remove(apiKeyId: string): Promise<void> {
        await $client.projectApiKeySettings.delete.mutate({ projectId, apiKeyId })
        await items.load()
      }

      return {
        items,
        get: async (apiKeyId: string) => {
          return await $client.projectApiKeySettings.get.query({ projectId, apiKeyId })
        },
        create,
        update,
        delete: remove,
        forServiceAccount: (serviceAccountId: string) => {
          return useCollectionQuery(query => {
            return $client.projectApiKeySettings.query.query({
              projectId,
              query: { ...query, serviceAccountId },
            })
          })
        },
        getServiceAccountOptions: async () => {
          return await $client.projectApiKeySettings.getServiceAccountOptions.query({ projectId })
        },
      }
    }),
})
