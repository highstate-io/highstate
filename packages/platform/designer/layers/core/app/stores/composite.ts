import { type ViewportTransform } from "@vue-flow/core"

export const useCompositeStore = defineMultiStore({
  name: "instance",
  getStoreId: (projectId: string, stateId: string, version: number) =>
    `projects/${projectId}/composites/${stateId}/${version}`,

  create: ({ storeId, id: [projectId, stateId, version], logger }) => {
    return defineStore(storeId, () => {
      const { vueFlowStore, nodeFactory, onNodesMoved, edgeEndpointOffsets } = useCanvasStore(
        "instance",
        projectId,
        stateId,
        version,
      )

      const { $client } = useNuxtApp()

      const { instancesStore, stateStore } = useExplicitProjectStores(projectId)

      const instanceState = computed(() => stateStore.stateIdToStateMap.get(stateId))
      const instance = computed(() => {
        const state = instanceState.value
        return state ? instancesStore.instances.get(state.instanceId) : undefined
      })

      const initialize = async () => {
        logger.info({ projectId }, "initializing composite instance store")

        const viewport = await $client.workspace.getCompositeViewport.query({
          projectId,
          stateId,
        })

        if (viewport) {
          vueFlowStore.defaultViewport.value = viewport as ViewportTransform
        }

        logger.info({ projectId, stateId }, "composite instance store initialized")
      }

      const placeNodes = () => {
        const currentInstance = instance.value
        if (!currentInstance) {
          throw new Error(`Virtual instance not found for state: ${stateId}`)
        }

        const instanceNode = nodeFactory.createNodeFromInstance(currentInstance, { type: "inputs" })
        const children = instancesStore.getInstanceChildren(currentInstance.id)

        nodeFactory.createNodesForModels(children, [], { readonly: true })

        if (currentInstance.outputs && Object.keys(currentInstance.outputs).length > 0) {
          nodeFactory.createNodeFromInstance(currentInstance, {
            id: "outputs",
            type: "outputs",
            readonly: true,
          })

          // restore the mapping of instance ID to node ID since it was overwritte by the outputs node
          nodeFactory.instanceIdToNodeIdMap.set(currentInstance.id, instanceNode.id)

          for (const [outputKey, output] of Object.entries(currentInstance.outputs)) {
            for (const item of output) {
              const instance = instancesStore.instances.get(item.instanceId)
              if (!instance) {
                continue
              }

              nodeFactory.createEdgeForInstanceOutput(instance, outputKey, item)
            }
          }
        }

        void waitForLayoutCompletion(vueFlowStore)
          .then(() => layoutNodes(vueFlowStore))
          .then(() => vueFlowStore.fitView())
          .then(() => setupEdgeRouter(vueFlowStore, onNodesMoved, edgeEndpointOffsets))
      }

      const debouncedSetViewport = useDebounceFn(async (viewport: ViewportTransform) => {
        await $client.workspace.setCompositeViewport.mutate({
          projectId,
          stateId,
          viewport,
        })
      }, 1000)

      vueFlowStore.onViewportChange(debouncedSetViewport)

      return {
        initialize,
        placeNodes,
        stateId,
        instanceState,
        instance,
        version,
      }
    })
  },
})
