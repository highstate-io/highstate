import type { Decrypter } from "age-encryption"
import type { GraphNode } from "@vue-flow/core"
import {
  getResolvedInstanceInputs,
  type InstanceState,
  type ResolvedInstanceInput,
  type ProjectUnlockState,
  type InstanceLockOutput,
  isInstanceDeployed,
} from "@highstate/backend/shared"
import {
  isUnitModel,
  type ComponentModel,
  type InstanceId,
  type InstanceModel,
} from "@highstate/contract"
import { armor } from "age-encryption"
import { useProjectInstancesStore } from "./instances"
import { useProjectLibraryStore } from "./library"

export const useProjectStateStore = defineMultiStore({
  name: "project-state",
  getStoreId: (projectId: string) => `projects/${projectId}/state`,

  create: ({ storeId, id: [projectId], logger, onDeactivated }) => {
    return defineStore(storeId, () => {
      const instancesStore = useProjectInstancesStore(projectId)
      const projectLibraryStore = useProjectLibraryStore(projectId)

      // TODO: refactor the whole frontend to use surrogate state IDs instead of instance IDs
      const stateIdToInstanceIdMap = shallowReactive(new Map<string, InstanceId>())
      const instanceStates = reactive(new Map<string, InstanceState>())
      const stateIdToStateMap = reactive(new Map<string, InstanceState>())
      const instanceLocks = shallowReactive(new Map<string, InstanceLockOutput>())
      const { $client } = useNuxtApp()

      const {
        inputs: inputHashInputs,
        outputs: inputHashOutputs,
        onOutput: onInputHashOutput,
        set: setInputHashInput,
        delete: deleteInputHashInput,
        dispatchInitialNodes: dispatchInitialInputHashNodes,
      } = useGraphResolverState("InputHashResolver", logger)

      const statesLoaded = ref(false)
      const initializationPhase = ref<"loading" | "calculating" | "ready">("loading")
      const calculatedInputHashCount = ref(0)

      const { on: onInstanceStateUpdated, trigger: triggerInstanceStateUpdated } = createEventHook<{
        instance: InstanceModel
        component: ComponentModel
        resolvedInputs: Record<string, ResolvedInstanceInput[]>
        state: InstanceState | undefined
      }>()

      onInputHashOutput(() => {
        if (calculatedInputHashCount.value < instancesStore.totalInstanceCount) {
          calculatedInputHashCount.value++
        }
      })

      const updateState = (state: InstanceState) => {
        instanceStates.set(state.instanceId, state)
        stateIdToInstanceIdMap.set(state.id, state.instanceId)
        stateIdToStateMap.set(state.id, state)

        const instance = instancesStore.instances.get(state.instanceId)
        if (!instance) return

        const component = projectLibraryStore.library.components[instance.type]

        const resolvedInputs = getResolvedInstanceInputs(
          instancesStore.inputResolverOutputs,
          instance.id,
        )

        setInputHashInput(instance.id, {
          instance,
          component,
          resolvedInputs,
          state,
          sourceHash: isUnitModel(component)
            ? projectLibraryStore.library.unitSourceHashes.get(instance.type)
            : undefined,
        })

        triggerInstanceStateUpdated({
          instance,
          component,
          resolvedInputs,
          state,
        })
      }

      const initialize = async () => {
        const { unsubscribe: stopWatchingInstanceStates } =
          $client.state.watchInstanceStates.subscribe(
            { projectId },
            {
              onData(event) {
                switch (event.type) {
                  case "updated": {
                    updateState(event.state)
                    logger.debug(
                      { stateId: event.state.id, instanceId: event.state.instanceId },
                      "instance state replaced",
                    )

                    break
                  }
                  case "patched": {
                    const instanceId = stateIdToInstanceIdMap.get(event.stateId)
                    if (!instanceId) {
                      logger.warn({ stateId: event.stateId }, "received patch for unknown state ID")
                      return
                    }

                    const existingState = instanceStates.get(instanceId)
                    const newState = { ...existingState, ...event.patch }

                    updateState(newState as InstanceState)
                    break
                  }
                  case "deleted": {
                    const instanceId = stateIdToInstanceIdMap.get(event.stateId)
                    if (!instanceId) {
                      logger.warn(
                        { stateId: event.stateId },
                        "received delete for unknown state ID",
                      )
                      return
                    }

                    instanceStates.delete(instanceId)
                    stateIdToStateMap.delete(event.stateId)
                    deleteInputHashInput(instanceId)

                    const instance = instancesStore.instances.get(instanceId)
                    if (!instance) return

                    const component = projectLibraryStore.library.components[instance.type]
                    const resolvedInputs = getResolvedInstanceInputs(
                      instancesStore.inputResolverOutputs,
                      instanceId,
                    )

                    triggerInstanceStateUpdated({
                      instance,
                      component,
                      resolvedInputs,
                      state: undefined,
                    })

                    break
                  }
                }
              },
            },
          )

        const { unsubscribe: stopWatchingInstanceLocks } =
          $client.state.watchInstanceLocks.subscribe(
            { projectId },
            {
              onData(event) {
                switch (event.type) {
                  case "locked": {
                    for (const lock of event.locks) {
                      instanceLocks.set(lock.stateId, lock)
                    }
                    break
                  }
                  case "unlocked": {
                    for (const lock of event.stateIds) {
                      instanceLocks.delete(lock)
                    }
                    break
                  }
                }
              },
            },
          )

        onDeactivated(stopWatchingInstanceLocks)
        onDeactivated(stopWatchingInstanceStates)

        const [loadedStates, loadedLocks] = await Promise.all([
          $client.state.getInstanceStates.query({ projectId }),
          $client.state.getInstanceLocks.query({ projectId }),
        ])

        for (const state of loadedStates) {
          instanceStates.set(state.instanceId, state)
          stateIdToInstanceIdMap.set(state.id, state.instanceId)
          stateIdToStateMap.set(state.id, state)
        }

        for (const lock of loadedLocks) {
          instanceLocks.set(lock.stateId, lock)
        }

        statesLoaded.value = true

        await until(() => instancesStore.initializationPhase).toBe("ready")

        initializationPhase.value = "calculating"
        await dispatchInitialInputHashNodes()
        initializationPhase.value = "ready"

        const { off: stopWatchingSourceHashChanges } =
          projectLibraryStore.library.onUnitSourceHashChanged(({ unitType, sourceHash }) => {
            const instances = instancesStore.componentTypeToInstancesMap.get(unitType) ?? []

            for (const instance of instances) {
              const resolvedInputs = getResolvedInstanceInputs(
                instancesStore.inputResolverOutputs,
                instance.id,
              )
              const component = projectLibraryStore.library.components[instance.type]

              setInputHashInput(instance.id, {
                instance,
                component,
                resolvedInputs,
                state: instanceStates.get(instance.id),
                sourceHash,
              })
            }
          })

        onDeactivated(stopWatchingSourceHashChanges)
      }

      const getInstanceState = (instanceId: InstanceId) => {
        const state = instanceStates.get(instanceId)
        if (!state) {
          throw new Error(`State for instance ${instanceId} not found`)
        }

        return state
      }

      const getStateByStateId = (stateId: string) => {
        const state = stateIdToStateMap.get(stateId)
        if (!state) {
          throw new Error(`State with ID ${stateId} not found`)
        }

        return state
      }

      instancesStore.onInstanceUpdated(async ({ instance, component, resolvedInputs }) => {
        await until(statesLoaded).toBe(true)

        setInputHashInput(instance.id, {
          instance,
          component,
          resolvedInputs,
          state: instanceStates.get(instance.id),
          sourceHash: isUnitModel(component)
            ? projectLibraryStore.library.unitSourceHashes.get(instance.type)
            : undefined,
        })
      })

      instancesStore.onInstanceDeleted(instanceId => {
        deleteInputHashInput(instanceId)
      })

      instancesStore.onInstanceNameChanged(({ oldId, newId }) => {
        // update instance state map
        const state = instanceStates.get(oldId)
        if (!state) return

        instanceStates.delete(oldId)
        instanceStates.set(newId, state)

        // update state ID to instance ID map
        stateIdToInstanceIdMap.set(state.id, newId)
      })

      const workspaceStore = useWorkspaceStore()

      const openInstanceLogs = async (instance: InstanceModel) => {
        const state = instanceStates.get(instance.id)
        if (!state?.lastOperationState) return

        await workspaceStore.openLogsPanel(
          projectId,
          state.lastOperationState.operationId,
          state.id,
        )
      }

      const getPage = async (pageId: string) => {
        return await $client.state.getPage.query({
          projectId,
          pageId,
        })
      }

      const getTerminalsState = (terminalIds: Ref<string[]>) => {
        return useAsyncState(
          async () => {
            return await $client.terminal.getTerminals.query({
              projectId,
              terminalIds: terminalIds.value,
            })
          },
          [],
          { immediate: false },
        )
      }

      const getPages = async (pageIds: string[]) => {
        return await $client.state.getInstancePages.query({ projectId, pageIds })
      }

      const getInstanceSecrets = async (stateId: string): Promise<Record<string, unknown>> => {
        return await $client.state.getInstanceSecrets.query({
          projectId,
          stateId,
        })
      }

      const updateInstanceSecrets = async (
        stateId: string,
        secretValues: Record<string, unknown>,
      ): Promise<void> => {
        await $client.state.updateInstanceSecrets.mutate({
          projectId,
          stateId,
          secretValues,
        })
      }

      const unlockState = ref<ProjectUnlockState>()

      const isUnlockImpossible = computed(() => {
        return (
          !!unlockState.value &&
          unlockState.value.type === "locked" &&
          (!unlockState.value.unlockSuite ||
            unlockState.value.unlockSuite.encryptedIdentities.length === 0)
        )
      })

      const { unsubscribe: stopWatchingUnlockState } = $client.state.watchUnlockState.subscribe(
        { projectId },
        {
          onData(newState) {
            unlockState.value = newState
          },
        },
      )

      onDeactivated(stopWatchingUnlockState)

      const unlock = async (decrypter: Decrypter) => {
        if (unlockState.value?.type === "unlocked") {
          return false
        }

        if (!unlockState.value?.unlockSuite) {
          logger.error("unlockSuite is not available, cannot unlock project")
          return false
        }

        let decryptedIdentity: string | null = null
        for (const encryptedIdentity of unlockState.value.unlockSuite.encryptedIdentities) {
          try {
            const decodedIdentity = armor.decode(encryptedIdentity)
            decryptedIdentity = await decrypter.decrypt(decodedIdentity, "text")
          } catch (error) {
            logger.debug({ error }, "failed to decrypt identity, trying next identity")
          }
        }

        if (!decryptedIdentity) {
          return false
        }

        await $client.state.unlockProject.mutate({ projectId, decryptedIdentity })
        return true
      }

      const forgetInstanceStates = async (
        instanceIds: InstanceId[],
        deleteSecrets = false,
        clearTerminalData = false,
      ) => {
        if (instanceIds.length === 0) {
          return
        }

        await $client.state.forgetInstanceStates.mutate({
          projectId,
          instanceIds,
          deleteSecrets,
          clearTerminalData,
        })

        for (const instanceId of instanceIds) {
          const instance = instancesStore.instances.get(instanceId)
          if (instance && instancesStore.isGhostInstance(instanceId)) {
            instancesStore.removeInstanceLocally(instanceId)

            // TODO: drop local removal once backend emits deletedGhostInstanceIds for forget operations
          }
        }
      }

      const isNodeDeletable = (node: GraphNode) => {
        if (!node.data.instance) {
          return true
        }

        const state = instanceStates.get(node.data.instance.id)
        return !isInstanceDeployed(state)
      }

      return {
        initialize,
        initializationPhase,
        calculatedInputHashCount,
        statesLoaded,

        getInstanceSecrets,
        updateInstanceSecrets,

        instanceStates,
        stateIdToStateMap,
        forgetInstanceStates,
        getInstanceState,
        getStateByStateId,
        openInstanceLogs,
        getPage,
        getTerminalsState,
        getPages,
        onInstanceStateUpdated,
        isNodeDeletable,

        unlockState,
        isUnlockImpossible,
        unlock,

        instanceLocks,

        // for debugging
        inputHashInputs,
        inputHashOutputs,
      }
    })
  },
})
