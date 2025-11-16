import { getResolvedInstanceInputs } from "@highstate/backend/shared"
import type { InstanceModel } from "@highstate/contract"

export const useProjectValidationStore = defineMultiStore({
  name: "project-validation",
  getStoreId: (projectId: string) => `projects/${projectId}/validation`,

  create: ({ storeId, id: [projectId], logger, onDeactivated }) => {
    return defineStore(storeId, () => {
      const instancesStore = useProjectInstancesStore(projectId)
      const libraryStore = useProjectLibraryStore(projectId)
      const stateStore = useProjectStateStore(projectId)

      const validatedInstanceCount = ref(0)

      const {
        inputs: validationInputs,
        outputs: validationOutputs,
        onOutput: onValidationOutput,
        set: setValidationInput,
        delete: deleteValidationInput,
        dispatchInitialNodes: dispatchInitialValidationNodes,
      } = useGraphResolverState("ValidationResolver", logger)

      const initialize = async () => {
        await until(() => instancesStore.initializationPhase).toBe("ready")
        await until(() => stateStore.initializationPhase).toMatch(
          phase => phase === "ready" || phase === "calculating",
        )

        const setInstanceInput = (instance: InstanceModel) => {
          const component = libraryStore.library.components[instance.type]
          const state = stateStore.instanceStates.get(instance.id)
          const resolvedInputs = getResolvedInstanceInputs(
            instancesStore.inputResolverOutputs,
            instance.id,
          )

          if (!component) {
            logger.warn(
              `component "%s" for instance "%s" not found in library during validation initialization`,
              instance.type,
              instance.id,
            )
            return
          }

          setValidationInput(instance.id, {
            instance,
            component,
            state,
            resolvedInputs,
          })
        }

        for (const instance of instancesStore.instances.values()) {
          setInstanceInput(instance)
        }

        const { off: stopWatchingComponentUpdates } = libraryStore.library.onComponentUpdated(
          component => {
            for (const [id, input] of validationInputs.entries()) {
              if (input.component.type === component.type) {
                setValidationInput(id, { ...input, component })
              }
            }
          },
        )

        onDeactivated(stopWatchingComponentUpdates)

        await dispatchInitialValidationNodes()
      }

      onValidationOutput(() => {
        if (validatedInstanceCount.value < instancesStore.totalInstanceCount) {
          validatedInstanceCount.value++
        }
      })

      instancesStore.onInstanceUpdated(({ instance, component, resolvedInputs }) => {
        if (instancesStore.initializationPhase !== "ready") {
          return
        }

        setValidationInput(instance.id, {
          instance,
          component,
          state: stateStore.instanceStates.get(instance.id),
          resolvedInputs,
        })
      })

      instancesStore.onInstanceDeleted(instanceId => {
        deleteValidationInput(instanceId)
      })

      stateStore.onInstanceStateUpdated(({ instance, component, state, resolvedInputs }) => {
        setValidationInput(instance.id, {
          instance,
          component,
          state,
          resolvedInputs,
        })
      })

      return {
        validationInputs,
        validationOutputs,
        initialize,
      }
    })
  },
})
