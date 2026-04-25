import type {
  CollectionQuery,
  CollectionQueryResult,
  UnlockMethodInput,
} from "@highstate/backend/shared"

type QueryFn<T> = (query: CollectionQuery) => Promise<CollectionQueryResult<T>>

function useSettingsQuery<T>(queryFn: QueryFn<T>) {
  const isLoading = ref(false)
  const search = ref("")
  const sortBy = ref<CollectionQuery["sortBy"]>([])
  const page = ref(1)
  const itemsPerPage = ref(10)
  const debouncedSearch = debouncedRef(search, 300)

  const query = computed<CollectionQuery>(() => ({
    count: itemsPerPage.value,
    skip: (page.value - 1) * itemsPerPage.value,
    sortBy: sortBy.value,
    search: debouncedSearch.value,
  }))

  const data = shallowRef<CollectionQueryResult<T>>({
    items: [],
    total: 0,
  })

  const { on: onReload, trigger: triggerReload } = createEventHook<[]>()

  watch(query, () => load())

  const load = async () => {
    isLoading.value = true

    try {
      data.value = await queryFn(query.value)
      triggerReload()
    } finally {
      isLoading.value = false
    }
  }

  const reset = () => {
    data.value = {
      items: [],
      total: 0,
    }
    page.value = 1
  }

  return {
    search,
    sortBy,
    page,
    itemsPerPage,
    isLoading,
    data,
    reset,
    load,
    onReload,
  }
}

export const useProjectSettingsStore = defineMultiStore({
  name: "project-settings",
  getStoreId: (projectId: string) => `projects/${projectId}/settings`,

  create: ({ storeId, id: [projectId], onDeactivated }) => {
    return defineStore(storeId, () => {
      const { $client } = useNuxtApp()

      type ReloadableSettingsQuery = {
        load: () => Promise<void>
      }

      const activeWorkerVersionQueries = shallowReactive(new Set<ReloadableSettingsQuery>())
      let workerReloadTimeout: ReturnType<typeof setTimeout> | undefined

      const operations = useSettingsQuery(query =>
        $client.settings.queryOperations.query({ projectId, query }),
      )
      const terminals = useSettingsQuery(query =>
        $client.settings.queryTerminals.query({ projectId, query }),
      )
      const pages = useSettingsQuery(query =>
        $client.settings.queryPages.query({ projectId, query }),
      )
      const secrets = useSettingsQuery(query =>
        $client.settings.querySecrets.query({ projectId, query }),
      )
      const triggers = useSettingsQuery(query =>
        $client.settings.queryTriggers.query({ projectId, query }),
      )
      const artifacts = useSettingsQuery(query =>
        $client.settings.queryArtifacts.query({ projectId, query }),
      )
      const workers = useSettingsQuery(query =>
        $client.settings.queryWorkers.query({ projectId, query }),
      )
      const serviceAccounts = useSettingsQuery(query =>
        $client.settings.queryServiceAccounts.query({ projectId, query }),
      )
      const apiKeys = useSettingsQuery(query =>
        $client.settings.queryApiKeys.query({ projectId, query }),
      )
      const entities = useSettingsQuery(query =>
        $client.settings.queryEntities.query({ projectId, query }),
      )
      const unlockMethods = useSettingsQuery(query =>
        $client.settings.queryUnlockMethods.query({ projectId, query }),
      )

      const refreshWorkerQueries = async () => {
        const versionQueries = Array.from(activeWorkerVersionQueries)

        await Promise.allSettled([
          workers.load(),
          ...versionQueries.map(query => query.load()),
        ])
      }

      const scheduleWorkerQueriesRefresh = () => {
        if (workerReloadTimeout) {
          return
        }

        workerReloadTimeout = setTimeout(() => {
          workerReloadTimeout = undefined
          void refreshWorkerQueries()
        }, 250)
      }

      const { unsubscribe: stopWatchingWorkerVersionStatuses } =
        $client.settings.watchWorkerVersionStatuses.subscribe(
          { projectId },
          {
            onData() {
              scheduleWorkerQueriesRefresh()
            },
          },
        )

      onDeactivated(() => {
        if (workerReloadTimeout) {
          clearTimeout(workerReloadTimeout)
          workerReloadTimeout = undefined
        }

        stopWatchingWorkerVersionStatuses()
      })

      const addUnlockMethod = async (unlockMethod: UnlockMethodInput) => {
        await $client.settings.addUnlockMethod.mutate({ projectId, unlockMethod })
        await unlockMethods.load()
      }

      const removeUnlockMethod = async (unlockMethodId: string) => {
        await $client.settings.removeUnlockMethod.mutate({
          projectId,
          unlockMethodId,
        })

        await unlockMethods.load()
      }

      const getTerminalDetails = async (terminalId: string) => {
        return await $client.settings.getTerminalDetails.query({
          projectId,
          terminalId,
        })
      }

      const getServiceAccountDetails = async (serviceAccountId: string) => {
        return await $client.settings.getServiceAccountDetails.query({
          projectId,
          serviceAccountId,
        })
      }

      const getApiKeyDetails = async (apiKeyId: string) => {
        return await $client.settings.getApiKeyDetails.query({
          projectId,
          apiKeyId,
        })
      }

      const getWorkerDetails = async (workerId: string) => {
        return await $client.settings.getWorkerDetails.query({
          projectId,
          workerId,
        })
      }
      const getWorkerVersionDetails = async (versionId: string) => {
        return await $client.settings.getWorkerVersionDetails.query({
          projectId,
          versionId,
        })
      }

      const restartWorkerVersion = async (workerVersionId: string) => {
        await $client.settings.restartWorkerVersion.mutate({
          projectId,
          workerVersionId,
        })

        await refreshWorkerQueries()
      }

      const getEntityDetails = async (entityId: string) => {
        return await $client.settings.getEntityDetails.query({
          projectId,
          entityId,
        })
      }

      const getEntitySnapshotDetails = async (snapshotId: string) => {
        return await $client.settings.getEntitySnapshotDetails.query({
          projectId,
          snapshotId,
        })
      }

      const getPageDetails = async (pageId: string) => {
        return await $client.settings.getPageDetails.query({
          projectId,
          pageId,
        })
      }

      const getSecretDetails = async (secretId: string) => {
        return await $client.settings.getSecretDetails.query({
          projectId,
          secretId,
        })
      }

      const getArtifactDetails = async (artifactId: string) => {
        return await $client.settings.getArtifactDetails.query({
          projectId,
          artifactId,
        })
      }

      const getOperationDetails = async (operationId: string) => {
        return await $client.settings.getOperationDetails.query({
          projectId,
          operationId,
        })
      }

      const getTriggerDetails = async (triggerId: string) => {
        return await $client.settings.getTriggerDetails.query({
          projectId,
          triggerId,
        })
      }

      const getUnlockMethodDetails = async (unlockMethodId: string) => {
        return await $client.settings.getUnlockMethodDetails.query({
          projectId,
          unlockMethodId,
        })
      }

      const outgoingReferencesForEntity = (entityId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntityOutgoingReferences.query({
            projectId,
            entityId,
            query,
          }),
        )

      const outgoingReferencesForEntitySnapshot = (snapshotId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntitySnapshotOutgoingReferences.query({
            projectId,
            snapshotId,
            query,
          }),
        )

      const incomingReferencesForEntity = (entityId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntityIncomingReferences.query({
            projectId,
            entityId,
            query,
          }),
        )

      const incomingReferencesForEntitySnapshot = (snapshotId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntitySnapshotIncomingReferences.query({
            projectId,
            snapshotId,
            query,
          }),
        )

      const snapshotsForEntity = (entityId: string, excludeSnapshotId?: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntitySnapshotsForEntity.query({
            projectId,
            entityId,
            excludeSnapshotId,
            query,
          }),
        )

      const entitySnapshotsForInstanceOperation = (stateId: string, operationId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryEntitySnapshotsForInstanceOperation.query({
            projectId,
            stateId,
            operationId,
            query,
          }),
        )

      const sessionsForTerminal = (terminalId: string) =>
        useSettingsQuery(query =>
          $client.settings.getTerminalSessions.query({ projectId, terminalId, query }),
        )

      const apiKeysForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryApiKeys.query({ projectId, query: { ...query, serviceAccountId } }),
        )

      const terminalsForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryTerminals.query({
            projectId,
            query: { ...query, serviceAccountId },
          }),
        )

      const pagesForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryPages.query({ projectId, query: { ...query, serviceAccountId } }),
        )

      const secretsForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.querySecrets.query({ projectId, query: { ...query, serviceAccountId } }),
        )

      const workersForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryWorkers.query({ projectId, query: { ...query, serviceAccountId } }),
        )

      const artifactsForServiceAccount = (serviceAccountId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryArtifacts.query({ projectId, query: { ...query, serviceAccountId } }),
        )

      const versionsForWorker = (workerId: string) => {
        const queryState = useSettingsQuery(query =>
          $client.settings.queryWorkerVersions.query({ projectId, workerId, query }),
        )

        activeWorkerVersionQueries.add(queryState)

        onDeactivated(() => {
          activeWorkerVersionQueries.delete(queryState)
        })

        return queryState
      }

      const terminalsForState = (stateId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryTerminals.query({
            projectId,
            query: { ...query, stateId },
          }),
        )

      const secretsForState = (stateId: string) =>
        useSettingsQuery(query =>
          $client.settings.querySecrets.query({ projectId, query: { ...query, stateId } }),
        )

      const pagesForState = (stateId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryPages.query({ projectId, query: { ...query, stateId } }),
        )

      const triggersForState = (stateId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryTriggers.query({ projectId, query: { ...query, stateId } }),
        )

      const artifactsForState = (stateId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryArtifacts.query({ projectId, query: { ...query, stateId } }),
        )

      const artifactsForTerminal = (terminalId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryArtifacts.query({ projectId, query: { ...query, terminalId } }),
        )

      const artifactsForPage = (pageId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryArtifacts.query({ projectId, query: { ...query, pageId } }),
        )

      const serviceAccountsForArtifact = (artifactId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryServiceAccounts.query({ projectId, query: { ...query, artifactId } }),
        )

      const terminalsForArtifact = (artifactId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryTerminals.query({ projectId, query: { ...query, artifactId } }),
        )

      const pagesForArtifact = (artifactId: string) =>
        useSettingsQuery(query =>
          $client.settings.queryPages.query({ projectId, query: { ...query, artifactId } }),
        )

      return {
        operations,
        terminals,
        pages,
        secrets,
        triggers,
        artifacts,
        workers,
        serviceAccounts,
        apiKeys,
        entities,
        unlockMethods,
        addUnlockMethod,
        removeUnlockMethod,
        getTerminalDetails,
        getServiceAccountDetails,
        getApiKeyDetails,
        getWorkerDetails,
        getWorkerVersionDetails,
        restartWorkerVersion,
        getEntityDetails,
        getEntitySnapshotDetails,
        getPageDetails,
        getSecretDetails,
        getArtifactDetails,
        getOperationDetails,
        getTriggerDetails,
        getUnlockMethodDetails,
        outgoingReferencesForEntity,
        outgoingReferencesForEntitySnapshot,
        incomingReferencesForEntity,
        incomingReferencesForEntitySnapshot,
        snapshotsForEntity,
        entitySnapshotsForInstanceOperation,
        sessionsForTerminal,
        apiKeysForServiceAccount,
        terminalsForServiceAccount,
        pagesForServiceAccount,
        secretsForServiceAccount,
        workersForServiceAccount,
        artifactsForServiceAccount,
        versionsForWorker,
        terminalsForState,
        secretsForState,
        pagesForState,
        triggersForState,
        artifactsForState,
        artifactsForTerminal,
        artifactsForPage,
        serviceAccountsForArtifact,
        terminalsForArtifact,
        pagesForArtifact,
      }
    })
  },
})
