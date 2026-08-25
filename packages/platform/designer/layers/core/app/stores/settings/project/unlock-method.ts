import type { UnlockMethodInput } from "@highstate/backend/shared"

export const useProjectUnlockMethodSettingsStore = defineMultiStore({
  name: "project-unlock-method-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/unlock-methods`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.unlockMethodSettings.query.query({ projectId, query })
      })

      return {
        items,
        get: async (unlockMethodId: string) => {
          return await $client.unlockMethodSettings.get.query({ projectId, unlockMethodId })
        },
        create: async (unlockMethod: UnlockMethodInput) => {
          await $client.unlockMethodSettings.create.mutate({ projectId, unlockMethod })
          await items.load()
        },
        delete: async (unlockMethodId: string) => {
          await $client.unlockMethodSettings.delete.mutate({ projectId, unlockMethodId })
          await items.load()
        },
      }
    }),
})
