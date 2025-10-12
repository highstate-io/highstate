import type { ResolvedInstanceInput, TerminalSessionOutput } from "@highstate/backend/shared"
import {
  getInstanceId,
  isUnitModel,
  type ComponentModel,
  type HubInput,
  type HubModel,
  type InstanceId,
  type InstanceInput,
  type InstanceModel,
  type InstanceModelPatch,
} from "@highstate/contract"
import { pick } from "remeda"
import { useProjectLibraryStore } from "./library"

export const useProjectInstancesStore = defineMultiStore({
  name: "project-instances",
  getStoreId: (projectId: string) => `projects/${projectId}/instances`,

  create: ({ storeId, id: [projectId], logger, onDeactivated }) => {
    return defineStore(storeId, () => {
      const instances = reactive(new Map<string, InstanceModel>())
      const hubs = shallowReactive(new Map<string, HubModel>())
      const instanceNameSet = shallowReactive(new Set<string>())
      const ghostInstanceIds = shallowReactive(new Set<string>())

      const totalInstanceCount = ref(0)
      const resolvedInstanceCount = ref(0)

      const evaluationVersion = ref(1)

      const libraryStore = useProjectLibraryStore(projectId)
      const { $client } = useNuxtApp()

      const {
        inputs: inputResolverInputs,
        outputs: inputResolverOutputs,
        dependentMap: inputResolverDependentMap,
        onOutput: onInputResolverOutput,
        set: setInputResolverInput,
        delete: deleteInputResolverInput,
        dispatchInitialNodes: dispatchInitialInputResolverNodes,
      } = useGraphResolverState("InputResolver", logger, mainResolverWorker, true)

      const { on: onInstanceCreated, trigger: triggerInstanceCreated } = createEventHook<{
        instance: InstanceModel
        blueprint: boolean
      }>()

      const { on: onInstanceUpdated, trigger: triggerInstanceUpdated } = createEventHook<{
        instance: InstanceModel
        component: ComponentModel
        resolvedInputs: Record<string, ResolvedInstanceInput[]>
      }>()

      const { on: onInstanceDeleted, trigger: triggerInstanceDeleted } = createEventHook<string>()

      const { on: onInstanceNameChanged, trigger: triggerInstanceNameChanged } = createEventHook<{
        oldName: string
        oldId: InstanceId
        newName: string
        newId: InstanceId
      }>()

      const { on: onHubCreated, trigger: triggerHubCreated } = createEventHook<{
        hub: HubModel
        blueprint: boolean
      }>()
      const { on: onHubDeleted, trigger: triggerHubDeleted } = createEventHook<string>()

      const componentTypeToInstancesMap = shallowReactive(new Map()) as Map<string, InstanceModel[]>

      const addComponentInstance = (instance: InstanceModel) => {
        const instances = componentTypeToInstancesMap.get(instance.type) ?? []
        instances.push(instance)
        componentTypeToInstancesMap.set(instance.type, instances)
      }

      const deleteComponentInstance = (componentType: string, instanceId: string) => {
        const instances = componentTypeToInstancesMap.get(componentType) ?? []
        const newInstances = instances.filter(instance => instance.id !== instanceId)
        componentTypeToInstancesMap.set(componentType, newInstances)
      }

      onInputResolverOutput(({ output }) => {
        if (output.kind === "hub") {
          return
        }

        triggerInstanceUpdated({
          instance: output.instance,
          component: output.component,
          resolvedInputs: output.resolvedInputs,
        })

        if (resolvedInstanceCount.value < totalInstanceCount.value) {
          resolvedInstanceCount.value++
        }
      })

      const updateInstanceStateCore = (instance: InstanceModel) => {
        const component = libraryStore.library.components[instance.type]
        if (!component) {
          return
        }

        logger.debug({ instance }, "updating instance state")

        setInputResolverInput(`instance:${instance.id}`, {
          kind: "instance",
          instance,
          component,
        })
      }

      const updateInstanceState = (instance: InstanceModel) => {
        updateInstanceStateCore(instance)
        instances.set(instance.id, instance)
      }

      const removeInstanceLocally = (instanceId: string) => {
        const existingInstance = instances.get(instanceId)
        if (!existingInstance) {
          return
        }

        logger.debug(
          { instanceId, instanceName: existingInstance?.name },
          "removing instance locally",
        )

        deleteInputResolverInput(`instance:${instanceId}`)
        triggerInstanceDeleted(instanceId)

        instances.delete(instanceId)
        ghostInstanceIds.delete(instanceId)
        instanceNameSet.delete(existingInstance.name)
      }

      const isGhostInstance = (instanceId: string) => {
        return ghostInstanceIds.has(instanceId)
      }

      const updateHubState = (hub: HubModel) => {
        logger.debug({ hub }, "updating hub state")

        setInputResolverInput(`hub:${hub.id}`, {
          kind: "hub",
          hub,
        })

        hubs.set(hub.id, hub)
      }

      const initializationPhase = ref<"loading" | "resolving" | "ready">("loading")

      const initialize = async () => {
        const projectModel = await $client.project.getProjectModel.query({ projectId })
        const unitTypes = new Set<string>()

        for (const instance of projectModel.instances) {
          populateInstanceUnitTypes(unitTypes, instance)
          totalInstanceCount.value++
        }

        for (const virtualInstance of projectModel.virtualInstances) {
          populateInstanceUnitTypes(unitTypes, virtualInstance)
          totalInstanceCount.value++
        }

        await libraryStore.library.ensureUnitSourceHashesLoaded(Array.from(unitTypes.values()))

        for (const instance of projectModel.instances) {
          updateInstanceState(instance)
          addComponentInstance(instance)
          instanceNameSet.add(instance.name)
        }

        for (const hub of projectModel.hubs) {
          console.log("loading hub", hub.id)
          updateHubState(hub)
        }

        for (const compositeInstance of projectModel.virtualInstances) {
          updateVirtualInstanceState(compositeInstance)
        }

        for (const ghostInstance of projectModel.ghostInstances ?? []) {
          ghostInstanceIds.add(ghostInstance.id)
          updateInstanceState(ghostInstance)
          addComponentInstance(ghostInstance)
          instanceNameSet.add(ghostInstance.name)
        }

        const { unsubscribe: stopWatchingCompositeInstances } =
          $client.project.watchProjectNodes.subscribe(
            { projectId },
            {
              async onData(event) {
                const promotedVirtualInstanceIds = new Set<string>()

                for (const virtualInstance of event.updatedVirtualInstances ?? []) {
                  promotedVirtualInstanceIds.add(virtualInstance.id)

                  const unitTypes = new Set<string>()
                  populateInstanceUnitTypes(unitTypes, virtualInstance)

                  await libraryStore.library.ensureUnitSourceHashesLoaded(
                    Array.from(unitTypes.values()),
                  )

                  updateVirtualInstanceState(virtualInstance)
                }

                for (const virtualInstanceId of event.deletedVirtualInstanceIds ?? []) {
                  removeInstanceLocally(virtualInstanceId)
                }

                if (event.updatedVirtualInstances || event.deletedVirtualInstanceIds) {
                  evaluationVersion.value++
                }

                for (const ghostInstance of event.updatedGhostInstances ?? []) {
                  const existingInstance = instances.get(ghostInstance.id)

                  ghostInstanceIds.add(ghostInstance.id)

                  if (!existingInstance) {
                    addComponentInstance(ghostInstance)
                    instanceNameSet.add(ghostInstance.name)
                  }

                  updateInstanceState(ghostInstance)

                  if (!existingInstance) {
                    await triggerInstanceCreated({ instance: ghostInstance, blueprint: false })
                  }
                }

                for (const ghostInstanceId of event.deletedGhostInstanceIds ?? []) {
                  ghostInstanceIds.delete(ghostInstanceId)

                  if (promotedVirtualInstanceIds.has(ghostInstanceId)) {
                    continue
                  }

                  if (!instances.has(ghostInstanceId)) {
                    continue
                  }

                  removeInstanceLocally(ghostInstanceId)
                }

                if (event.updatedGhostInstances || event.deletedGhostInstanceIds) {
                  evaluationVersion.value++
                }
              },
            },
          )

        onDeactivated(stopWatchingCompositeInstances)
      }

      const postInitialize = async () => {
        initializationPhase.value = "resolving"
        await dispatchInitialInputResolverNodes()

        initializationPhase.value = "ready"
      }

      const populateInstanceUnitTypes = (unitTypes: Set<string>, instance: InstanceModel) => {
        const component = libraryStore.library.components[instance.type]
        if (component && isUnitModel(component)) {
          unitTypes.add(instance.type)
        }
      }

      const updateVirtualInstanceState = (instance: InstanceModel) => {
        const topLevelInstance = instances.get(instance.id)
        if (topLevelInstance) {
          topLevelInstance.outputs = instance.outputs
          topLevelInstance.resolvedOutputs = instance.resolvedOutputs
          updateInstanceStateCore(topLevelInstance)
        } else {
          updateInstanceState(instance)
          addComponentInstance(instance)
        }
      }

      const patchInstance = async (instance: InstanceModel, keys: (keyof InstanceModelPatch)[]) => {
        await $client.project.updateInstance.mutate({
          projectId,
          instanceId: instance.id,
          patch: pick(instance, keys),
        })
      }

      const patchHub = async (hub: HubModel, keys: (keyof HubModel)[]) => {
        await $client.project.updateHub.mutate({
          projectId,
          hubId: hub.id,
          patch: pick(hub, keys),
        })
      }

      const getNextInstanceName = (componentType: string) => {
        const component = libraryStore.library.components[componentType]
        const namePrefix = getComponentNamePrefix(component)

        let index = 1
        let candidateName = `${namePrefix}-${index}`

        while (instanceNameSet.has(candidateName)) {
          index++
          candidateName = `${namePrefix}-${index}`
        }

        return candidateName
      }

      const workspaceStore = useWorkspaceStore()

      const openTerminal = async (terminalId: string, newSession = false) => {
        const session = await $client.terminal.getOrCreateTerminalSession.mutate({
          projectId,
          terminalId,
          newSession,
        })

        workspaceStore.openTerminalPanel(projectId, session.id)
      }

      const openTerminalSession = async (session: TerminalSessionOutput) => {
        workspaceStore.openTerminalPanel(projectId, session.id)
      }

      const getTerminalSessionsState = (stateId: Ref<string>) => {
        return useAsyncState(
          () => {
            return $client.terminal.getInstanceTerminalSessions.query({
              projectId,
              stateId: stateId.value,
            })
          },
          [],
          { immediate: false, resetOnExecute: false },
        )
      }

      const { on: onInstanceInputAdded, trigger: triggerInstanceInputAdded } = createEventHook<{
        instance: InstanceModel
        inputName: string
        input: InstanceInput
      }>()

      const { on: onInstanceHubInputAdded, trigger: triggerInstanceHubInputAdded } =
        createEventHook<{
          instance: InstanceModel
          inputName: string
          input: HubInput
        }>()

      const { on: onInstanceInjectionInputAdded, trigger: triggerInstanceInjectionInputAdded } =
        createEventHook<{
          instance: InstanceModel
          input: HubInput
        }>()

      const { on: onHubInputAdded, trigger: triggerHubInputAdded } = createEventHook<{
        hub: HubModel
        input: InstanceInput
      }>()

      const { on: onHubInjectionInputAdded, trigger: triggerHubInjectionInputAdded } =
        createEventHook<{
          hub: HubModel
          input: HubInput
        }>()

      const addInstanceInput = async (
        instance: InstanceModel,
        inputName: string,
        input: InstanceInput,
        patch = true,
      ): Promise<void> => {
        const inputs = instance.inputs ?? {}
        const inputList = inputs[inputName] ?? []

        inputList.push(input)

        inputs[inputName] = inputList
        instance.inputs = inputs

        triggerInstanceInputAdded({ instance, inputName, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["inputs"])
        }
      }

      const addInstanceHubInput = async (
        instance: InstanceModel,
        inputName: string,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const hubInputs = instance.hubInputs ?? {}
        const inputList = hubInputs[inputName] ?? []

        inputList.push(input)

        hubInputs[inputName] = inputList
        instance.hubInputs = hubInputs

        triggerInstanceHubInputAdded({ instance, inputName, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["hubInputs"])
        }
      }

      const addInstanceInjectionInput = async (
        instance: InstanceModel,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const injectionInputs = instance.injectionInputs ?? []
        injectionInputs.push(input)

        instance.injectionInputs = injectionInputs

        triggerInstanceInjectionInputAdded({ instance, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["injectionInputs"])
        }
      }

      const addHubInput = async (
        hub: HubModel,
        input: InstanceInput,
        patch = true,
      ): Promise<void> => {
        const inputs = hub.inputs ?? []
        inputs.push(input)

        hub.inputs = inputs

        triggerHubInputAdded({ hub, input })
        updateHubState(hub)

        if (patch) {
          await patchHub(hub, ["inputs"])
        }
      }

      const addHubInjectionInput = async (
        hub: HubModel,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const injectionInputs = hub.injectionInputs ?? []
        injectionInputs.push(input)

        hub.injectionInputs = injectionInputs

        triggerHubInjectionInputAdded({ hub, input })
        updateHubState(hub)

        if (patch) {
          await patchHub(hub, ["injectionInputs"])
        }
      }

      const deleteArrayIfEmpty = <
        TContainer extends Record<string, unknown>,
        TKey extends keyof TContainer,
      >(
        container: TContainer,
        key: TKey,
      ) => {
        if (!container[key]) {
          delete container[key]
        }

        if (Array.isArray(container[key]) && !container[key].length) {
          delete container[key]
        }
      }

      const { on: onInstanceInputRemoved, trigger: triggerInstanceInputRemoved } = createEventHook<{
        instance: InstanceModel
        inputName: string
        input: InstanceInput
      }>()

      const { on: onInstanceHubInputRemoved, trigger: triggerInstanceHubInputRemoved } =
        createEventHook<{
          instance: InstanceModel
          inputName: string
          input: HubInput
        }>()

      const { on: onInstanceInjectionInputRemoved, trigger: triggerInstanceInjectionInputRemoved } =
        createEventHook<{
          instance: InstanceModel
          input: HubInput
        }>()

      const { on: onHubInputRemoved, trigger: triggerHubInputRemoved } = createEventHook<{
        hub: HubModel
        input: InstanceInput
      }>()

      const { on: onHubInjectionInputRemoved, trigger: triggerHubInjectionInputRemoved } =
        createEventHook<{
          hub: HubModel
          input: HubInput
        }>()

      const removeInstanceInput = async (
        instance: InstanceModel,
        inputName: string,
        input: InstanceInput,
        patch = true,
      ): Promise<void> => {
        const inputs = instance.inputs ?? {}
        let inputList = inputs[inputName] ?? []

        inputList = inputList.filter(item => {
          return item.instanceId !== input.instanceId || item.output !== input.output
        })

        inputs[inputName] = inputList
        deleteArrayIfEmpty(inputs, inputName)

        instance.inputs = inputs

        triggerInstanceInputRemoved({ instance, inputName, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["inputs"])
        }
      }

      const removeInstanceHubInput = async (
        instance: InstanceModel,
        inputName: string,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const hubInputs = instance.hubInputs ?? {}
        let inputList = hubInputs[inputName] ?? []

        inputList = inputList.filter(item => item.hubId !== input.hubId)

        hubInputs[inputName] = inputList
        deleteArrayIfEmpty(hubInputs, inputName)

        instance.hubInputs = hubInputs

        triggerInstanceHubInputRemoved({ instance, inputName, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["hubInputs"])
        }
      }

      const removeInstanceInjectionInput = async (
        instance: InstanceModel,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const injectionInputs = instance.injectionInputs ?? []
        const inputList = injectionInputs.filter(item => item.hubId !== input.hubId)

        instance.injectionInputs = inputList

        triggerInstanceInjectionInputRemoved({ instance, input })
        updateInstanceState(instance)

        if (patch) {
          await patchInstance(instance, ["injectionInputs"])
        }
      }

      const removeHubInput = async (
        hub: HubModel,
        input: InstanceInput,
        patch = true,
      ): Promise<void> => {
        const inputs = hub.inputs ?? []
        const inputList = inputs.filter(item => {
          return item.instanceId !== input.instanceId || item.output !== input.output
        })

        hub.inputs = inputList

        triggerHubInputRemoved({ hub, input })
        updateHubState(hub)

        if (patch) {
          await patchHub(hub, ["inputs"])
        }
      }

      const removeHubInjectionInput = async (
        hub: HubModel,
        input: HubInput,
        patch = true,
      ): Promise<void> => {
        const injectionInputs = hub.injectionInputs ?? []
        const inputList = injectionInputs.filter(item => item.hubId !== input.hubId)

        hub.injectionInputs = inputList

        triggerHubInjectionInputRemoved({ hub, input })
        updateHubState(hub)

        if (patch) {
          await patchHub(hub, ["injectionInputs"])
        }
      }

      const getUniqueInstanceName = (name: string) => {
        if (!instanceNameSet.has(name)) {
          return name
        }

        // try to extract the existing suffix from the name
        const match = name.match(/-(\d+)$/)
        let suffix = 1
        if (match) {
          suffix = parseInt(match[1], 10) + 1
          name = name.slice(0, match.index)
        }

        // ensure the name is unique by appending a suffix
        let candidateName = `${name}-${suffix}`
        while (instanceNameSet.has(candidateName)) {
          suffix++
          candidateName = `${name}-${suffix}`
        }

        return candidateName
      }

      const createBlueprintInstance = async (instance: InstanceModel) => {
        updateInstanceState(instance)
        instanceNameSet.add(instance.name)
        addComponentInstance(instance)

        const component = libraryStore.library.components[instance.type]

        await triggerInstanceCreated({ instance, blueprint: true })

        if (isUnitModel(component)) {
          void libraryStore.library.ensureUnitSourceHashesLoaded([instance.type], true)
        }
      }

      const updateInstanceReferencesInInstance = (
        instance: InstanceModel,
        targetInstanceId: string,
        newInstanceId: InstanceId,
      ) => {
        for (const [inputName, inputs] of Object.entries(instance.inputs ?? {})) {
          for (const input of inputs) {
            if (input.instanceId === targetInstanceId) {
              removeInstanceInput(instance, inputName, input, false)
              addInstanceInput(
                instance,
                inputName,
                { instanceId: newInstanceId, output: input.output },
                false,
              )
            }
          }
        }
      }

      const updateInstanceReferencesInHub = (
        hub: HubModel,
        targetInstanceId: string,
        newInstanceId: InstanceId,
      ) => {
        for (const input of hub.inputs ?? []) {
          if (input.instanceId === targetInstanceId) {
            removeHubInput(hub, input, false)
            addHubInput(hub, { instanceId: newInstanceId, output: input.output }, false)
          }
        }
      }

      const updateInstance = async (
        instanceId: InstanceId,
        newName: string,
        newArgs: Record<string, unknown>,
      ) => {
        const instance = instances.get(instanceId)
        if (!instance) {
          throw new Error(`Instance ${instanceId} not found`)
        }

        if (instance.name !== newName) {
          const oldName = instance.name
          const newInstanceId = getInstanceId(instance.type, newName)

          triggerInstanceNameChanged({
            oldName,
            oldId: instanceId,
            newName,
            newId: newInstanceId,
          })

          instanceNameSet.add(newName)

          instance.id = newInstanceId
          instance.name = newName

          updateInstanceState(instance)

          for (const targetInstance of instances.values()) {
            if (targetInstance.id === instance.id) {
              continue
            }

            updateInstanceReferencesInInstance(targetInstance, instanceId, newInstanceId)
          }

          for (const hub of hubs.values()) {
            updateInstanceReferencesInHub(hub, instanceId, newInstanceId)
          }

          removeInstanceLocally(instanceId)

          await $client.project.renameInstance.mutate({
            projectId,
            instanceId,
            newName,
          })
        }

        if (JSON.stringify(instance.args) !== JSON.stringify(newArgs)) {
          instance.args = newArgs

          updateInstanceState(instance)
          await patchInstance(instance, ["args"])
        }
      }

      const deleteInstanceReferencesInInstance = (
        instance: InstanceModel,
        targetInstanceId: string,
      ) => {
        for (const [inputName, inputs] of Object.entries(instance.inputs ?? {})) {
          for (const input of inputs) {
            if (input.instanceId === targetInstanceId) {
              removeInstanceInput(instance, inputName, input, false)
            }
          }
        }
      }

      const deleteInstanceReferencesInHub = (hub: HubModel, targetInstanceId: string) => {
        for (const input of hub.inputs ?? []) {
          if (input.instanceId === targetInstanceId) {
            removeHubInput(hub, input, false)
          }
        }
      }

      const deleteInstance = async (instance: InstanceModel, persistent = true) => {
        for (const otherInstance of instances.values()) {
          if (otherInstance.id === instance.id) {
            continue
          }

          deleteInstanceReferencesInInstance(otherInstance, instance.id)
        }

        for (const hub of hubs.values()) {
          deleteInstanceReferencesInHub(hub, instance.id)
        }

        triggerInstanceDeleted(instance.id)
        removeInstanceLocally(instance.id)
        deleteComponentInstance(instance.type, instance.id)

        if (persistent) {
          await $client.project.deleteInstance.mutate({
            projectId,
            instanceId: instance.id,
          })
        }
      }

      const createBlueprintHub = async (hub: HubModel) => {
        updateHubState(hub)

        await triggerHubCreated({ hub, blueprint: true })
      }

      const deleteHubReferencesInInstance = (instance: InstanceModel, targetHubId: string) => {
        for (const input of instance.injectionInputs ?? []) {
          if (input.hubId === targetHubId) {
            removeInstanceInjectionInput(instance, input, false)
          }
        }

        for (const [inputName, inputs] of Object.entries(instance.hubInputs ?? {})) {
          for (const input of inputs) {
            if (input.hubId === targetHubId) {
              removeInstanceHubInput(instance, inputName, input, false)
            }
          }
        }
      }

      const deleteHubReferencesInHub = (hub: HubModel, targetHubId: string) => {
        for (const input of hub.injectionInputs ?? []) {
          if (input.hubId === targetHubId) {
            removeHubInjectionInput(hub, input, false)
          }
        }
      }

      const deleteHub = async (hub: HubModel, persistent = true) => {
        hubs.delete(hub.id)
        deleteInputResolverInput(`hub:${hub.id}`)

        for (const instance of instances.values()) {
          deleteHubReferencesInInstance(instance, hub.id)
        }

        for (const targetHub of hubs.values()) {
          if (targetHub.id === hub.id) {
            continue
          }

          deleteHubReferencesInHub(targetHub, hub.id)
        }

        await triggerHubDeleted(hub.id)

        if (persistent) {
          await $client.project.deleteHub.mutate({ projectId, hubId: hub.id })
        }
      }

      const createManyNodes = async (instances: InstanceModel[], hubs: HubModel[]) => {
        await $client.project.createManyNodes.mutate({
          projectId,
          instances,
          hubs,
        })
      }

      const getInstanceChildren = (instanceId: string): InstanceModel[] => {
        const children: InstanceModel[] = []
        for (const instance of instances.values()) {
          if (instance.parentId === instanceId) {
            children.push(instance)
          }
        }

        return children
      }

      const getProjectInstances = (): InstanceModel[] => {
        const instancesArray: InstanceModel[] = []
        for (const instance of instances.values()) {
          if (!instance.parentId) {
            instancesArray.push(instance)
          }
        }

        return instancesArray
      }

      return {
        initialize,
        postInitialize,
        initializationPhase,

        instances,
        hubs,
        patchInstance,
        patchHub,

        getNextInstanceName,
        getUniqueInstanceName,
        createBlueprintInstance,
        updateInstance,
        deleteInstance,

        createBlueprintHub,
        deleteHub,

        createManyNodes,

        openTerminal,
        openTerminalSession,
        getTerminalSessionsState,

        componentTypeToInstancesMap,
        getInstanceChildren,
        getProjectInstances,
        evaluationVersion,

        onInstanceCreated,
        onInstanceUpdated,
        onInstanceNameChanged,
        onInstanceDeleted,

        onHubCreated,
        onHubDeleted,

        onInstanceInputAdded,
        onInstanceHubInputAdded,
        onInstanceInjectionInputAdded,
        onHubInputAdded,
        onHubInjectionInputAdded,

        addInstanceInput,
        addInstanceHubInput,
        addInstanceInjectionInput,
        addHubInput,
        addHubInjectionInput,

        onInstanceInputRemoved,
        onInstanceHubInputRemoved,
        onInstanceInjectionInputRemoved,
        onHubInputRemoved,
        onHubInjectionInputRemoved,

        removeInstanceInput,
        removeInstanceHubInput,
        removeInstanceInjectionInput,
        removeHubInput,
        removeHubInjectionInput,

        addComponentInstance,
        updateInstanceState,
        updateHubState,
        removeInstanceLocally,
        isGhostInstance,
        deleteComponentInstance,

        onInputResolverOutput,
        inputResolverDependentMap,

        // for debugging
        inputResolverInputs,
        inputResolverOutputs,
        instanceNameSet,

        totalInstanceCount,
        resolvedInstanceCount,
      }
    })
  },
})
