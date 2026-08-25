import type { BackendRoleInput } from "@highstate/backend/shared"

export const useBackendRoleSettingsStore = defineStore("backend-role-settings", () => {
  const { $client } = useNuxtApp()
  const items = useCollectionQuery(query => {
    return $client.backendRoleSettings.query.query(query)
  })

  async function create(role: BackendRoleInput) {
    const result = await $client.backendRoleSettings.create.mutate(role)
    await items.load()

    return result
  }

  async function update(roleId: string, role: BackendRoleInput) {
    const result = await $client.backendRoleSettings.update.mutate({ roleId, role })
    await items.load()

    return result
  }

  async function remove(roleId: string): Promise<void> {
    await $client.backendRoleSettings.delete.mutate({ roleId })
    await items.load()
  }

  return {
    items,
    get: async (roleId: string) => {
      return await $client.backendRoleSettings.get.query({ roleId })
    },
    create,
    update,
    delete: remove,
    getRestrictionOptions: async () => {
      return await $client.backendRoleSettings.getRestrictionOptions.query()
    },
  }
})
