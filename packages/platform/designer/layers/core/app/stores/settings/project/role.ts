import type { ProjectRoleInput } from "@highstate/backend/shared"

export const useProjectRoleSettingsStore = defineMultiStore({
  name: "project-role-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/roles`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.projectRoleSettings.query.query({ projectId, query })
      })

      async function create(role: ProjectRoleInput) {
        const result = await $client.projectRoleSettings.create.mutate({ projectId, role })
        await items.load()

        return result
      }

      async function update(roleId: string, role: ProjectRoleInput) {
        const result = await $client.projectRoleSettings.update.mutate({
          projectId,
          roleId,
          role,
        })
        await items.load()

        return result
      }

      async function remove(roleId: string): Promise<void> {
        await $client.projectRoleSettings.delete.mutate({ projectId, roleId })
        await items.load()
      }

      return {
        items,
        get: async (roleId: string) => {
          return await $client.projectRoleSettings.get.query({ projectId, roleId })
        },
        create,
        update,
        delete: remove,
        getRestrictionOptions: async () => {
          return await $client.projectRoleSettings.getRestrictionOptions.query({ projectId })
        },
      }
    }),
})
