import type { ServiceAccountInput } from "@highstate/backend/shared"

export const useProjectServiceAccountSettingsStore = defineMultiStore({
  name: "project-service-account-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/service-accounts`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()
      const items = useCollectionQuery(query => {
        return $client.projectServiceAccountSettings.query.query({ projectId, query })
      })

      async function create(serviceAccount: ServiceAccountInput) {
        const result = await $client.projectServiceAccountSettings.create.mutate({
          projectId,
          serviceAccount,
        })
        await items.load()

        return result
      }

      async function update(serviceAccountId: string, serviceAccount: ServiceAccountInput) {
        const result = await $client.projectServiceAccountSettings.update.mutate({
          projectId,
          serviceAccountId,
          serviceAccount,
        })
        await items.load()

        return result
      }

      async function remove(serviceAccountId: string): Promise<void> {
        await $client.projectServiceAccountSettings.delete.mutate({ projectId, serviceAccountId })
        await items.load()
      }

      return {
        items,
        get: async (serviceAccountId: string) => {
          return await $client.projectServiceAccountSettings.get.query({
            projectId,
            serviceAccountId,
          })
        },
        create,
        update,
        delete: remove,
        forArtifact: (artifactId: string) => {
          return useCollectionQuery(query => {
            return $client.projectServiceAccountSettings.query.query({
              projectId,
              query: { ...query, artifactId },
            })
          })
        },
        getRoleBindings: async (serviceAccountId: string) => {
          return await $client.projectServiceAccountSettings.getRoleBindings.query({
            projectId,
            serviceAccountId,
          })
        },
        getRoleBindingsByRole: async (roleId: string) => {
          return await $client.projectServiceAccountSettings.getRoleBindingsByRole.query({
            projectId,
            roleId,
          })
        },
        addRoleBinding: async (roleId: string, serviceAccountId: string) => {
          return await $client.projectServiceAccountSettings.addRoleBinding.mutate({
            projectId,
            roleId,
            serviceAccountId,
          })
        },
        removeRoleBinding: async (roleId: string, serviceAccountId: string) => {
          return await $client.projectServiceAccountSettings.removeRoleBinding.mutate({
            projectId,
            roleId,
            serviceAccountId,
          })
        },
      }
    }),
})
