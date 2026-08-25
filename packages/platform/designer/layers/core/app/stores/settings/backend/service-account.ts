import type { BackendServiceAccountInput } from "@highstate/backend/shared"

export const useBackendServiceAccountSettingsStore = defineStore(
  "backend-service-account-settings",
  () => {
    const { $client } = useNuxtApp()
    const items = useCollectionQuery(query => {
      return $client.backendServiceAccountSettings.query.query(query)
    })

    async function create(serviceAccount: BackendServiceAccountInput) {
      const result = await $client.backendServiceAccountSettings.create.mutate(serviceAccount)
      await items.load()

      return result
    }

    async function update(serviceAccountId: string, serviceAccount: BackendServiceAccountInput) {
      const result = await $client.backendServiceAccountSettings.update.mutate({
        serviceAccountId,
        serviceAccount,
      })
      await items.load()

      return result
    }

    async function remove(serviceAccountId: string): Promise<void> {
      await $client.backendServiceAccountSettings.delete.mutate({ serviceAccountId })
      await items.load()
    }

    return {
      items,
      get: async (serviceAccountId: string) => {
        return await $client.backendServiceAccountSettings.get.query({ serviceAccountId })
      },
      create,
      update,
      delete: remove,
      getRoleBindings: async (serviceAccountId: string) => {
        return await $client.backendServiceAccountSettings.getRoleBindings.query({
          serviceAccountId,
        })
      },
      getRoleBindingsByRole: async (roleId: string) => {
        return await $client.backendServiceAccountSettings.getRoleBindingsByRole.query({ roleId })
      },
      addRoleBinding: async (roleId: string, serviceAccountId: string) => {
        return await $client.backendServiceAccountSettings.addRoleBinding.mutate({
          roleId,
          serviceAccountId,
        })
      },
      removeRoleBinding: async (roleId: string, serviceAccountId: string) => {
        return await $client.backendServiceAccountSettings.removeRoleBinding.mutate({
          roleId,
          serviceAccountId,
        })
      },
      getProjectBindingOptions: async (serviceAccountId: string) => {
        return await $client.backendServiceAccountSettings.getProjectBindingOptions.query({
          serviceAccountId,
        })
      },
      setProjectBinding: async (
        serviceAccountId: string,
        projectId: string,
        projectServiceAccountId: string | null,
      ) => {
        return await $client.backendServiceAccountSettings.setProjectBinding.mutate({
          serviceAccountId,
          projectId,
          projectServiceAccountId,
        })
      },
    }
  },
)
