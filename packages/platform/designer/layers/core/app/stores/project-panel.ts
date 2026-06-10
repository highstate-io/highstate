import type { Connection, Edge, ViewportTransform } from "@vue-flow/core"
import { SYSTEM_EXPORT_COMPONENT_TYPE } from "@highstate/backend/shared"
import { useCanvasStore } from "./canvas"
import { EXPORT_CREATE_INPUT_HANDLE } from "#layers/core/app/utils/vue-flow"

export const useProjectPanelStore = defineMultiStore({
  name: "project-panel",
  getStoreId: (projectId: string) => `projects/${projectId}/panel`,

  create: ({ storeId, id: [projectId], logger }) => {
    return defineStore(storeId, () => {
      const { instancesStore, libraryStore } = useExplicitProjectStores(projectId)
      const instanceFocusRequest = shallowRef<{ instanceId: string; requestId: number }>()
      let nextFocusRequestId = 0

      const {
        vueFlowStore,
        nodeFactory,
        onHubMoved,
        onInstanceMoved,
        onHubNodeDeleted,
        onInstanceNodeDeleted,
        onNodesMoved,
        edgeEndpointOffsets,
      } = useCanvasStore.ensureCreated("project", projectId)

      const { $client } = useNuxtApp()

      const debouncedSetViewport = useDebounceFn(async (viewport: ViewportTransform) => {
        await $client.workspace.setProjectViewport.mutate({ projectId, viewport })
      }, 1000)

      vueFlowStore.onViewportChange(debouncedSetViewport)

      const initialize = async () => {
        globalLogger.info({ projectId }, "initializing project panel store")

        const viewport = await $client.workspace.getProjectViewport.query({ projectId })

        if (viewport) {
          vueFlowStore.defaultViewport.value = viewport as ViewportTransform
        }
      }

      const placeNodes = async () => {
        nodeFactory.createNodesForModels(
          //
          instancesStore.getProjectInstances(),
          [...instancesStore.hubs.values()],
        )

        void waitForLayoutCompletion(vueFlowStore)
          //
          .then(() => setupEdgeRouter(vueFlowStore, onNodesMoved, edgeEndpointOffsets))
      }

      const requestInstanceFocus = (instanceId: string) => {
        nextFocusRequestId += 1
        instanceFocusRequest.value = { instanceId, requestId: nextFocusRequestId }
      }

      const clearInstanceFocusRequest = (requestId: number) => {
        if (instanceFocusRequest.value?.requestId === requestId) {
          instanceFocusRequest.value = undefined
        }
      }

      onInstanceMoved(instance => {
        void instancesStore.patchInstance(instance, ["position"])
      })

      onHubMoved(hub => {
        void instancesStore.patchHub(hub, ["position"])
      })

      onHubNodeDeleted(node => {
        void instancesStore.deleteHub(node.data.hub, !node.data.blueprint)
      })

      onInstanceNodeDeleted(node => {
        void instancesStore.deleteInstance(node.data.instance, !node.data.blueprint)
      })

      const addInput = async (connection: Connection) => {
        const { inputInstance, outputInstance, inputHub, outputHub, outputKey, inputKey } =
          getConnectionNodes(vueFlowStore, connection)

        let effectiveInputKey = inputKey

        if (outputInstance?.type === SYSTEM_EXPORT_COMPONENT_TYPE) {
          throw new Error("Export port cannot be a connection source")
        }

        if (outputHub && inputInstance?.type === SYSTEM_EXPORT_COMPONENT_TYPE && !inputKey) {
          throw new Error("Export port does not allow injection inputs")
        }

        const canAddDependency = await instancesStore.canAddInputDependency(
          { instance: inputInstance, hub: inputHub },
          { instance: outputInstance, hub: outputHub },
        )

        if (!canAddDependency) {
          logger.warn(
            {
              connection,
              inputInstanceId: inputInstance?.id,
              inputHubId: inputHub?.id,
              outputInstanceId: outputInstance?.id,
              outputHubId: outputHub?.id,
            },
            "connection rejected by cycle",
          )
          throw new Error("Circular dependency")
        }

        if (
          inputInstance &&
          inputKey === EXPORT_CREATE_INPUT_HANDLE &&
          inputInstance.type === SYSTEM_EXPORT_COMPONENT_TYPE
        ) {
          if (!outputInstance) {
            throw new Error("Create-input handle supports only instance outputs")
          }

          const outputComponent = instancesStore.getInstanceComponent(outputInstance)
          const output = outputComponent?.outputs[outputKey]

          if (!output) {
            throw new Error(`Output "${outputKey}" not found in instance "${outputInstance.id}"`)
          }

          const outputEntity = libraryStore.library.entities[output.type]

          effectiveInputKey = instancesStore.createEditableExportInput(inputInstance, {
            outputTitle: outputEntity?.meta.title,
          })
        }

        if (inputInstance && outputInstance) {
          return await instancesStore.addInstanceInput(inputInstance, effectiveInputKey, {
            instanceId: outputInstance.id,
            output: outputKey,
          })
        }

        if (outputHub && inputInstance && effectiveInputKey) {
          return await instancesStore.addInstanceHubInput(inputInstance, effectiveInputKey, {
            hubId: outputHub.id,
          })
        }

        if (outputHub && inputInstance) {
          return await instancesStore.addInstanceInjectionInput(inputInstance, {
            hubId: outputHub.id,
          })
        }

        if (outputInstance && inputHub) {
          return await instancesStore.addHubInput(inputHub, {
            instanceId: outputInstance.id,
            output: outputKey,
          })
        }

        if (outputHub && inputHub) {
          return await instancesStore.addHubInjectionInput(inputHub, {
            hubId: outputHub.id,
          })
        }

        logger.error({
          msg: "unexpected connection while adding",
          connection,
          inputInstance,
          outputInstance,
          inputHub,
          outputHub,
          outputKey,
          inputKey,
        })

        throw new Error("Invalid connection")
      }

      const removeInput = (edge: Edge) => {
        const { inputInstance, outputInstance, inputHub, outputHub, outputKey, inputKey } =
          getConnectionNodes(vueFlowStore, edge)

        if (inputInstance && outputInstance) {
          return instancesStore.removeInstanceInput(inputInstance, inputKey, {
            instanceId: outputInstance.id,
            output: outputKey,
          })
        }

        if (outputHub && inputInstance && inputKey) {
          return instancesStore.removeInstanceHubInput(inputInstance, inputKey, {
            hubId: outputHub.id,
          })
        }

        if (outputHub && inputInstance) {
          return instancesStore.removeInstanceInjectionInput(inputInstance, {
            hubId: outputHub.id,
          })
        }

        if (outputInstance && inputHub) {
          return instancesStore.removeHubInput(inputHub, {
            instanceId: outputInstance.id,
            output: outputKey,
          })
        }

        if (outputHub && inputHub) {
          return instancesStore.removeHubInjectionInput(inputHub, {
            hubId: outputHub.id,
          })
        }

        logger.error({
          msg: "unexpected connection while removing",
          edge,
          inputInstance,
          outputInstance,
          inputHub,
          outputHub,
          outputKey,
          inputKey,
        })

        throw new Error("Invalid connection")
      }

      vueFlowStore.onConnect(addInput)

      let edgeUpdated = false

      vueFlowStore.onEdgeUpdate(async ({ edge, connection }) => {
        edgeUpdated = true

        await removeInput(edge)
        await addInput(connection)
      })

      vueFlowStore.onEdgeUpdateEnd(async ({ edge }) => {
        try {
          if (edgeUpdated) {
            return
          }

          await removeInput(edge)
        } finally {
          edgeUpdated = false
        }
      })

      instancesStore.onInstanceInputAdded(({ instance, inputName, input }) => {
        nodeFactory.createEdgeForInstanceInput(instance, inputName, input)
      })

      instancesStore.onInstanceHubInputAdded(({ instance, inputName, input }) => {
        nodeFactory.createEdgeForInstanceHubInput(instance, inputName, input)
      })

      instancesStore.onInstanceInjectionInputAdded(({ instance, input }) => {
        nodeFactory.createEdgeForInstanceInjectionInput(instance, input)
      })

      instancesStore.onHubInputAdded(({ hub, input }) => {
        nodeFactory.createEdgeForHubInput(hub, input)
      })

      instancesStore.onHubInjectionInputAdded(({ hub, input }) => {
        nodeFactory.createEdgeForHubInjectionInput(hub, input)
      })

      instancesStore.onInstanceInputRemoved(({ instance, inputName, input }) => {
        nodeFactory.removeEdgeForInstanceInput(instance, inputName, input)
      })

      instancesStore.onInstanceHubInputRemoved(({ instance, inputName, input }) => {
        nodeFactory.removeEdgeForInstanceHubInput(instance, inputName, input)
      })

      instancesStore.onInstanceInjectionInputRemoved(({ instance, input }) => {
        nodeFactory.removeEdgeForInstanceInjectionInput(instance, input)
      })

      instancesStore.onHubInputRemoved(({ hub, input }) => {
        nodeFactory.removeEdgeForHubInput(hub, input)
      })

      instancesStore.onHubInjectionInputRemoved(({ hub, input }) => {
        nodeFactory.removeEdgeForHubInjectionInput(hub, input)
      })

      instancesStore.onInstanceNameChanged(({ oldId, newId }) => {
        const currentNodeId = nodeFactory.instanceIdToNodeIdMap.get(oldId)
        nodeFactory.instanceIdToNodeIdMap.set(newId, currentNodeId!)
        nodeFactory.instanceIdToNodeIdMap.delete(oldId)

        vueFlowStore.updateNodeData(currentNodeId!, {})
      })

      instancesStore.onInstanceCreated(async ({ instance, blueprint }) => {
        const node = nodeFactory.createNodeFromInstance(instance, { blueprint })
        await until(vueFlowStore.areNodesInitialized).toBe(true)

        if (!blueprint) {
          if (instancesStore.isGhostInstance(instance.id)) {
            return
          }

          vueFlowStore.updateNode(node.id, node => {
            const newPosition = {
              x: node.position.x - node.dimensions.width / 2,
              y: node.position.y - node.dimensions.height / 2,
            }

            instance.position = newPosition

            return {
              position: newPosition,
            }
          })
        }
      })

      instancesStore.onInstanceDeleted(instanceId => {
        const nodeId = nodeFactory.instanceIdToNodeIdMap.get(instanceId)

        if (nodeId) {
          vueFlowStore.removeNodes(nodeId)
          nodeFactory.instanceIdToNodeIdMap.delete(instanceId)
        }
      })

      instancesStore.onHubDeleted(hubId => {
        vueFlowStore.removeNodes(hubId)
      })

      instancesStore.onHubCreated(async ({ hub, blueprint }) => {
        nodeFactory.createNodeFromHub(hub, { blueprint })
        await until(vueFlowStore.areNodesInitialized).toBe(true)

        if (!blueprint) {
          vueFlowStore.updateNode(hub.id, node => {
            const newPosition = {
              x: node.position.x - node.dimensions.width / 2,
              y: node.position.y - node.dimensions.height / 2,
            }

            hub.position = newPosition

            return {
              position: newPosition,
            }
          })
        }
      })

      return {
        initialize,
        placeNodes,
        instanceFocusRequest,
        requestInstanceFocus,
        clearInstanceFocusRequest,
      }
    })
  },
})
