import type { BackendApiKeyInput } from "@highstate/backend/shared"

export const useBackendApiKeySettingsStore = defineStore("backend-api-key-settings", () => {
  const { $client } = useNuxtApp()
  const items = useCollectionQuery(query => {
    return $client.backendApiKeySettings.query.query(query)
  })

  async function create(apiKey: BackendApiKeyInput) {
    const result = await $client.backendApiKeySettings.create.mutate(apiKey)
    await items.load()

    return result
  }

  async function update(apiKeyId: string, apiKey: BackendApiKeyInput) {
    const result = await $client.backendApiKeySettings.update.mutate({ apiKeyId, apiKey })
    await items.load()

    return result
  }

  async function remove(apiKeyId: string): Promise<void> {
    await $client.backendApiKeySettings.delete.mutate({ apiKeyId })
    await items.load()
  }

  return {
    items,
    get: async (apiKeyId: string) => {
      return await $client.backendApiKeySettings.get.query({ apiKeyId })
    },
    create,
    update,
    delete: remove,
    getServiceAccountOptions: async () => {
      return await $client.backendApiKeySettings.getServiceAccountOptions.query()
    },
  }
})
