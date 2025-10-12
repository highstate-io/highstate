import type { Edge, Node, VueFlowStore } from "@vue-flow/core"
import {
  parseInstanceId,
  type HubInput,
  type HubModel,
  type InstanceId,
  type InstanceInput,
  type InstanceModel,
} from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"

export type SharedNodeData = {
  editable: boolean
  blueprint: boolean
}

export type InstanceNodeData = SharedNodeData & {
  instance: InstanceModel
}

export type HubNodeData = SharedNodeData & {
  hub: HubModel
}

export type InstanceNodeModel = Node<InstanceNodeData>
export type HubNodeModel = Node<HubNodeData>

export type CreateNodeOptions = {
  id?: string
  type?: string
  blueprint?: boolean
  readonly?: boolean
  hidden?: boolean
}

const commonNodeOptions: Partial<Node> = {
  deletable: true,
  selectable: false,
  focusable: false,
}

const commonEdgeOptions: Partial<Edge> = {
  updatable: true,
  animated: true,
  deletable: true,
  selectable: false,
  focusable: false,
  data: {},
}

export type NodeFactory = ReturnType<typeof useNodeFactory>

export function useNodeFactory(vueFlowStore: VueFlowStore) {
  const instanceIdToNodeIdMap = shallowReactive(new Map<string, string>())
  const componentTypeToInstancesMap = shallowReactive(new Map<string, InstanceModel[]>())

  const addInstanceToComponentTypeMap = (instance: InstanceModel) => {
    const instances = componentTypeToInstancesMap.get(instance.type) ?? []

    componentTypeToInstancesMap.set(instance.type, [...instances, instance])
  }

  const removeInstanceFromComponentTypeMap = (instanceId: InstanceId) => {
    const [type] = parseInstanceId(instanceId)

    const instances = componentTypeToInstancesMap.get(type) ?? []

    componentTypeToInstancesMap.set(
      type,
      instances.filter(i => i.id !== instanceId),
    )
  }

  const createNodeFromInstance = (
    instance: InstanceModel,
    { id, type, blueprint = false, readonly, hidden }: CreateNodeOptions = {},
  ): InstanceNodeModel => {
    const node: InstanceNodeModel = {
      id: id ?? createId(),
      type: type ?? "instance",
      data: { instance, blueprint, editable: !readonly },
      position: instance.position ?? { x: 0, y: 0 },
      connectable: !readonly && !blueprint,
      hidden,
      ...commonNodeOptions,
    }

    vueFlowStore.addNodes(node)
    instanceIdToNodeIdMap.set(instance.id, node.id)
    addInstanceToComponentTypeMap(instance)

    return node
  }

  const createNodeFromHub = (
    hub: HubModel,
    { type, blueprint = false, readonly, hidden }: CreateNodeOptions = {},
  ) => {
    vueFlowStore.addNodes({
      id: hub.id,
      type: type ?? "hub",
      data: { hub, blueprint, editable: !readonly },
      position: hub.position ?? { x: 0, y: 0 },
      connectable: !readonly && !blueprint,
      hidden,
      ...commonNodeOptions,
    })
  }

  const getInstanceNodeId = (instanceId: string) => {
    const nodeId = instanceIdToNodeIdMap.get(instanceId)
    if (!nodeId) {
      globalLogger.warn({
        msg: "could not find node id for instance",
        instanceId,
      })
    }

    return nodeId
  }

  const createEdgeForInstanceInput = (
    instance: InstanceModel,
    inputName: string,
    input: InstanceInput,
  ): string | undefined => {
    const sourceNodeId = getInstanceNodeId(input.instanceId)
    if (!sourceNodeId) return

    const targetNodeId = getInstanceNodeId(instance.id)
    if (!targetNodeId) return

    const edgeId = `${input.instanceId}:${input.output}->${instance.id}:${inputName}`
    if (vueFlowStore.findEdge(edgeId)) return

    vueFlowStore.addEdges({
      id: edgeId,
      type: "custom",
      source: sourceNodeId,
      sourceHandle: input.output,
      target: targetNodeId,
      targetHandle: inputName,
      ...commonEdgeOptions,
    })

    return edgeId
  }

  const createEdgesForInstanceInputs = (instance: InstanceModel): string[] => {
    const edgeIds: string[] = []

    for (const [inputName, inputs] of Object.entries(instance.inputs ?? {})) {
      for (const input of inputs) {
        const edgeId = createEdgeForInstanceInput(instance, inputName, input)
        if (edgeId) {
          edgeIds.push(edgeId)
        }
      }
    }

    return edgeIds
  }

  const createEdgeForInstanceOutput = (
    instance: InstanceModel,
    outputName: string,
    output: InstanceInput,
  ) => {
    const sourceNodeId = getInstanceNodeId(instance.id)
    if (!sourceNodeId) return

    vueFlowStore.addEdges({
      id: `${instance.id}:${output.output}->outputs:${outputName}`,
      type: "custom",
      source: sourceNodeId,
      sourceHandle: output.output,
      target: "outputs",
      targetHandle: outputName,
      ...commonEdgeOptions,
    })
  }

  const createEdgeForInstanceHubInput = (
    instance: InstanceModel,
    inputName: string,
    input: HubInput,
  ): string | undefined => {
    const targetNodeId = getInstanceNodeId(instance.id)
    if (!targetNodeId) return

    const edgeId = `${input.hubId}->${instance.id}:${inputName}`
    if (vueFlowStore.findEdge(edgeId)) return

    vueFlowStore.addEdges({
      id: edgeId,
      type: "custom",
      source: input.hubId,
      target: targetNodeId,
      targetHandle: inputName,
      ...commonEdgeOptions,
    })

    return edgeId
  }

  const createEdgesForInstanceHubInputs = (instance: InstanceModel): string[] => {
    const edgeIds: string[] = []

    for (const [inputName, inputs] of Object.entries(instance.hubInputs ?? {})) {
      for (const input of inputs) {
        const edgeId = createEdgeForInstanceHubInput(instance, inputName, input)
        if (edgeId) {
          edgeIds.push(edgeId)
        }
      }
    }

    return edgeIds
  }

  const createEdgeForInstanceInjectionInput = (
    instance: InstanceModel,
    input: HubInput,
  ): string | undefined => {
    const targetNodeId = getInstanceNodeId(instance.id)
    if (!targetNodeId) return

    const edgeId = `${input.hubId}->${instance.id}`
    if (vueFlowStore.findEdge(edgeId)) return

    vueFlowStore.addEdges({
      id: edgeId,
      type: "custom",
      source: input.hubId,
      target: targetNodeId,
      ...commonEdgeOptions,
    })

    return edgeId
  }

  const createEdgesForInstanceInjectionInputs = (instance: InstanceModel): string[] => {
    const edgeIds: string[] = []

    for (const input of instance.injectionInputs ?? []) {
      const edgeId = createEdgeForInstanceInjectionInput(instance, input)
      if (edgeId) {
        edgeIds.push(edgeId)
      }
    }

    return edgeIds
  }

  const createEdgesForInstance = (instance: InstanceModel): string[] => {
    return [
      ...createEdgesForInstanceInputs(instance),
      ...createEdgesForInstanceHubInputs(instance),
      ...createEdgesForInstanceInjectionInputs(instance),
    ]
  }

  const createEdgeForHubInput = (hub: HubModel, input: InstanceInput): string | undefined => {
    const sourceNodeId = getInstanceNodeId(input.instanceId)
    if (!sourceNodeId) return

    const edgeId = `${input.instanceId}:${input.output}->${hub.id}`
    if (vueFlowStore.findEdge(edgeId)) return

    vueFlowStore.addEdges({
      id: edgeId,
      type: "custom",
      source: sourceNodeId,
      sourceHandle: input.output,
      target: hub.id,
      ...commonEdgeOptions,
    })

    return edgeId
  }

  const createEdgesForHubInputs = (hub: HubModel): string[] => {
    const edgeIds: string[] = []

    for (const input of hub.inputs ?? []) {
      const edgeId = createEdgeForHubInput(hub, input)
      if (edgeId) {
        edgeIds.push(edgeId)
      }
    }

    return edgeIds
  }

  const createEdgeForHubInjectionInput = (hub: HubModel, input: HubInput): string | undefined => {
    const edgeId = `${input.hubId}->${hub.id}`
    if (vueFlowStore.findEdge(edgeId)) return

    vueFlowStore.addEdges({
      id: edgeId,
      type: "custom",
      source: input.hubId,
      target: hub.id,
      ...commonEdgeOptions,
    })

    return edgeId
  }

  const createEdgesForHubInjectionInputs = (hub: HubModel): string[] => {
    const edgeIds: string[] = []

    for (const input of hub.injectionInputs ?? []) {
      const edgeId = createEdgeForHubInjectionInput(hub, input)
      if (edgeId) {
        edgeIds.push(edgeId)
      }
    }

    return edgeIds
  }

  const createEdgesForHub = (hub: HubModel): string[] => {
    return [
      //
      ...createEdgesForHubInputs(hub),
      ...createEdgesForHubInjectionInputs(hub),
    ]
  }

  const removeEdgeForInstanceInput = (
    instance: InstanceModel,
    inputName: string,
    input: InstanceInput,
  ) => {
    vueFlowStore.removeEdges(`${input.instanceId}:${input.output}->${instance.id}:${inputName}`)
  }

  const removeEdgeForInstanceHubInput = (
    instance: InstanceModel,
    inputName: string,
    input: HubInput,
  ) => {
    vueFlowStore.removeEdges(`${input.hubId}->${instance.id}:${inputName}`)
  }

  const removeEdgeForInstanceInjectionInput = (instance: InstanceModel, input: HubInput) => {
    vueFlowStore.removeEdges(`${input.hubId}->${instance.id}`)
  }

  const removeEdgeForHubInput = (hub: HubModel, input: InstanceInput) => {
    vueFlowStore.removeEdges(`${input.instanceId}:${input.output}->${hub.id}`)
  }

  const removeEdgeForHubInjectionInput = (hub: HubModel, input: HubInput) => {
    vueFlowStore.removeEdges(`${input.hubId}->${hub.id}`)
  }

  const removeNodeForInstance = (instanceId: InstanceId) => {
    const nodeId = instanceIdToNodeIdMap.get(instanceId)
    if (!nodeId) return

    vueFlowStore.removeNodes(nodeId)
    instanceIdToNodeIdMap.delete(instanceId)
    removeInstanceFromComponentTypeMap(instanceId)
  }

  const removeNodeForHub = (hub: HubModel) => {
    vueFlowStore.removeNodes(hub.id)
  }

  const createNodesForModels = (
    instances: Iterable<InstanceModel>,
    hubs: Iterable<HubModel>,
    options: CreateNodeOptions = {},
  ) => {
    for (const instance of instances) {
      createNodeFromInstance(instance, options)
    }

    for (const hub of hubs) {
      createNodeFromHub(hub, options)
    }

    for (const instance of instances) {
      createEdgesForInstance(instance)
    }

    for (const hub of hubs) {
      createEdgesForHub(hub)
    }
  }

  return {
    instanceIdToNodeIdMap,
    createNodeFromInstance,
    createNodeFromHub,
    createEdgesForInstance,
    createEdgesForHub,

    createEdgeForInstanceInput,
    createEdgeForInstanceOutput,
    createEdgeForInstanceHubInput,
    createEdgeForInstanceInjectionInput,

    createEdgeForHubInput,
    createEdgeForHubInjectionInput,

    removeNodeForInstance,
    removeNodeForHub,

    removeEdgeForInstanceInput,
    removeEdgeForInstanceHubInput,
    removeEdgeForInstanceInjectionInput,

    removeEdgeForHubInput,
    removeEdgeForHubInjectionInput,

    createNodesForModels,
  }
}
