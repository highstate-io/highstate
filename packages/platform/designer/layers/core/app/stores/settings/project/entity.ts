export const useProjectEntitySettingsStore = defineMultiStore({
  name: "project-entity-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings/entities`,
  create: ({ storeId, id: [projectId] }) =>
    defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      return {
        items: useCollectionQuery(query => {
          return $client.entitySettings.query.query({ projectId, query })
        }),
        get: async (entityId: string) => {
          return await $client.entitySettings.get.query({ projectId, entityId })
        },
        getSnapshot: async (snapshotId: string) => {
          return await $client.entitySettings.getSnapshot.query({ projectId, snapshotId })
        },
        snapshots: (entityId: string, excludeSnapshotId?: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.querySnapshots.query({
              projectId,
              entityId,
              excludeSnapshotId,
              query,
            })
          })
        },
        snapshotsForInstanceOperation: (stateId: string, operationId: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.querySnapshotsForInstanceOperation.query({
              projectId,
              stateId,
              operationId,
              query,
            })
          })
        },
        outgoingReferences: (entityId: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.queryOutgoingReferences.query({
              projectId,
              entityId,
              query,
            })
          })
        },
        snapshotOutgoingReferences: (snapshotId: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.querySnapshotOutgoingReferences.query({
              projectId,
              snapshotId,
              query,
            })
          })
        },
        incomingReferences: (entityId: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.queryIncomingReferences.query({
              projectId,
              entityId,
              query,
            })
          })
        },
        snapshotIncomingReferences: (snapshotId: string) => {
          return useCollectionQuery(query => {
            return $client.entitySettings.querySnapshotIncomingReferences.query({
              projectId,
              snapshotId,
              query,
            })
          })
        },
      }
    }),
})
