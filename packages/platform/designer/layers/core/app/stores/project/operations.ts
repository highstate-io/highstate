import {
  isFinalOperationStatus,
  type Operation,
  type OperationLaunchInput,
  type OperationPlanInput,
  type OperationPhase,
  type OperationType,
  type OperationOptions,
} from "@highstate/backend/shared"
import type { InstanceId, InstanceModel } from "@highstate/contract"

export const useProjectOperationsStore = defineMultiStore({
  name: "project-operations",
  getStoreId: (projectId: string) => `projects/${projectId}/operations`,

  create: ({ storeId, id: [projectId], onDeactivated }) => {
    return defineStore(storeId, () => {
      const operationsMap = shallowReactive(new Map<string, Operation>())
      const requestedInstanceIds = shallowReactive(new Set<string>())
      const operations = ref<Operation[]>([])
      const { $client } = useNuxtApp()

      const { trigger: triggerOperationFinished, on: onOperationFinished } = createEventHook()

      const instancesStore = useProjectInstancesStore(projectId)
      const stateStore = useProjectStateStore(projectId)
      const validationStore = useProjectValidationStore(projectId)

      const initialize = async () => {
        const data = await $client.operation.getLastOperations.query({ projectId })

        for (const operation of data) {
          operationsMap.set(operation.id, operation)
        }

        operations.value = data

        const { unsubscribe: stopWatchingOperations } = $client.operation.watch.subscribe(
          { projectId },
          {
            onData(event) {
              switch (event.type) {
                case "updated": {
                  const operation = event.operation

                  if (operationsMap.has(operation.id)) {
                    operationsMap.set(operation.id, operation)
                    operations.value = operations.value.map(op =>
                      op.id === operation.id ? operation : op,
                    )
                  } else {
                    // new operation, prepend to the list, since it sorts by createdAt
                    operationsMap.set(operation.id, operation)
                    operations.value = [operation, ...operations.value]
                  }

                  if (isFinalOperationStatus(operation.status)) {
                    triggerOperationFinished(operation)
                  }

                  break
                }
                case "deleted": {
                  operationsMap.delete(event.operationId)
                  operations.value = operations.value.filter(op => op.id !== event.operationId)
                  break
                }
              }
            },
          },
        )

        onDeactivated(stopWatchingOperations)
      }

      const launchOperation = async (request: OperationLaunchInput) => {
        if (request.type === "preview" && request.instanceIds.length !== 1) {
          throw new Error("Preview operations require exactly one instance")
        }

        for (const instanceId of request.instanceIds) {
          if (requestedInstanceIds.has(instanceId)) {
            throw new Error(`Instance ${instanceId} is already requested for an operation`)
          }
        }

        try {
          for (const instanceId of request.instanceIds) {
            requestedInstanceIds.add(instanceId)
          }

          return await $client.operation.launch.mutate(request)
        } finally {
          for (const instanceId of request.instanceIds) {
            requestedInstanceIds.delete(instanceId)
          }
        }
      }

      const planOperation = async (request: OperationPlanInput): Promise<OperationPhase[]> => {
        if (request.type === "preview" && request.instanceIds.length !== 1) {
          throw new Error("Preview operations require exactly one instance")
        }

        return await $client.operation.plan.mutate(request)
      }

      const planInstanceOperation = async (
        type: OperationType,
        instance: InstanceModel,
        options?: Partial<OperationOptions>,
      ): Promise<OperationPhase[]> => {
        if (type === "preview" && instance.kind !== "unit") {
          throw new Error("Preview is only supported for unit instances")
        }

        return await planOperation({
          projectId,
          type,
          instanceIds: [instance.id],
          options,
        })
      }

      const launchInstanceOperation = async (
        type: OperationType,
        instance: InstanceModel,
        options?: Partial<OperationOptions>,
      ) => {
        if (type === "preview" && instance.kind !== "unit") {
          throw new Error("Preview is only supported for unit instances")
        }

        return await launchOperation({
          projectId,
          type,
          instanceIds: [instance.id],
          options,
          meta: { title: generateOperationTitle(type, instance) },
        })
      }

      const cancelOperation = async (operationId: string) => {
        await $client.operation.cancel.mutate({ operationId })
      }

      const cancelInstanceOperation = async (operationId: string, instanceId: InstanceId) => {
        await $client.operation.cancelInstance.mutate({
          projectId,
          operationId,
          instanceId,
        })
      }

      const isOperationForInstanceRequested = (instanceId: string) => {
        return requestedInstanceIds.has(instanceId)
      }

      const getLastInstanceOperation = (instanceId: string) => {
        const state = stateStore.instanceStates.get(instanceId)
        if (!state?.lastOperationState?.operationId) return undefined

        return operationsMap.get(state.lastOperationState.operationId)
      }

      const instancesToAutoUpdate = computed(() => {
        return Array.from(instancesStore.instances.values()).filter(instance => {
          const state = stateStore.instanceStates.get(instance.id)
          if (!state?.lastOperationState?.operationId) return true

          const operation = operationsMap.get(state.lastOperationState.operationId)
          if (operation && !isFinalOperationStatus(operation.status)) return false

          const validationState = validationStore.validationOutputs.get(instance.id)
          if (validationState?.status !== "ok") return false

          if (state.lastOperationState.status !== "updated") return true

          // todo: implement input hash comparison when we have proper hash calculation
          // const output = stateStore.inputHashOutputs.get(instance.id)
          // if (!output?.inputHash) return false
          // return state.lastOperationState.resolvedInputsHash !== output.inputHash

          return false // for now, don't auto-update based on input hash changes
        })
      })

      return {
        initialize,

        operations,
        operationsMap,
        planOperation,
        planInstanceOperation,
        launchOperation,
        launchInstanceOperation,
        cancelOperation,
        cancelInstanceOperation,
        onOperationFinished,
        isOperationForInstanceRequested,

        instancesToAutoUpdate,
        getLastInstanceOperation,
      }
    })
  },
})
