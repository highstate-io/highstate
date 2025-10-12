import type { CursorMode, NodeFactory } from "#layers/core/app/features/canvas"
import type { Blueprint } from "./shared"
import type { GraphEdge, GraphNode, VueFlowStore, XYPosition } from "@vue-flow/core"
import type { EventHookTrigger } from "@vueuse/core"
import { getInstanceId, type InstanceId } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"

export function positionBlueprintNodes(
  blueprint: Blueprint,
  vueFlowStore: VueFlowStore,
  nodeFactory: NodeFactory,
  centerPosition: XYPosition,
) {
  const halfWidth = blueprint.boundary.width / 2
  const halfHeight = blueprint.boundary.height / 2

  for (const instance of blueprint.instances) {
    const nodeId = nodeFactory.instanceIdToNodeIdMap.get(instance.id)
    if (!nodeId) {
      continue
    }

    vueFlowStore.updateNode(nodeId, () => ({
      position: {
        x: centerPosition.x - halfWidth + instance.position!.x,
        y: centerPosition.y - halfHeight + instance.position!.y,
      },
    }))
  }

  for (const hub of blueprint.hubs) {
    vueFlowStore.updateNode(hub.id, () => ({
      position: {
        x: centerPosition.x - halfWidth + hub.position!.x,
        y: centerPosition.y - halfHeight + hub.position!.y,
      },
    }))
  }
}

export function useBlueprintPlacement(
  vueFlowStore: VueFlowStore,
  nodeFactory: NodeFactory,
  instancesStore: ProjectInstancesStore,
  cursorMode: Ref<CursorMode>,
  blueprint: Ref<Blueprint | undefined>,
  triggerNodesMoved: EventHookTrigger<[GraphNode[], GraphEdge[]]>,
  deleteNode: (node: GraphNode) => void,
) {
  const blueprintCenter = useMouse()
  const { escape } = useMagicKeys()
  const { pressed: mouseButton } = useMousePressed()

  const blueprintNodes: GraphNode[] = []
  const blueprintEdges: GraphEdge[] = []
  const previousHandledPosition = ref<{ x: number; y: number }>()

  const updateBlueprintPosition = (blueprint: Blueprint) => {
    const centerPosition = vueFlowStore.screenToFlowCoordinate({
      x: blueprintCenter.x.value,
      y: blueprintCenter.y.value,
    })

    positionBlueprintNodes(blueprint, vueFlowStore, nodeFactory, centerPosition)

    const prevDiffX = previousHandledPosition.value
      ? centerPosition.x - previousHandledPosition.value.x
      : 0
    const prevDiffY = previousHandledPosition.value
      ? centerPosition.y - previousHandledPosition.value.y
      : 0

    // calculate the new paths for edges based the diff between the previous and current position
    for (const edge of blueprintEdges) {
      const points = (edge.data.points as number[][]) ?? []

      if (edge.data.points) {
        const newPoints = points.map(point => [point[0] + prevDiffX, point[1] + prevDiffY])

        vueFlowStore.updateEdgeData(edge.id, { points: newPoints })
      }
    }

    previousHandledPosition.value = {
      x: centerPosition.x,
      y: centerPosition.y,
    }

    triggerNodesMoved(blueprintNodes, blueprintEdges)
  }

  const clearBlueprintState = () => {
    previousHandledPosition.value = undefined
    blueprintNodes.length = 0
    blueprintEdges.length = 0
  }

  const clearBlueprint = () => {
    for (const node of blueprintNodes) {
      deleteNode(node)
    }

    clearBlueprintState()
  }

  const createBlueprint = async (blueprint: Blueprint) => {
    const instanceRenameMap = new Map<string, InstanceId>()
    const hubRenameMap = new Map<string, string>()

    // ensure that blueprint instances does not conflict with existing instances
    for (const instance of blueprint.instances) {
      const oldId = instance.id
      instance.name = instancesStore.getUniqueInstanceName(instance.name)
      instance.id = getInstanceId(instance.type, instance.name)
      instanceRenameMap.set(oldId, instance.id)
    }

    for (const hub of blueprint.hubs) {
      const oldId = hub.id

      // regenerate the hub id to ensure uniqueness
      hub.id = createId()
      hubRenameMap.set(oldId, hub.id)
    }

    // update references to renamed instances and hubs
    for (const instance of blueprint.instances) {
      for (const input of Object.values(instance.inputs ?? {})) {
        for (const item of input) {
          const renamedId = instanceRenameMap.get(item.instanceId)
          if (renamedId) {
            item.instanceId = renamedId
          }
        }
      }

      for (const input of Object.values(instance.hubInputs ?? {})) {
        for (const item of input) {
          const renamedId = hubRenameMap.get(item.hubId)
          if (renamedId) {
            item.hubId = renamedId
          }
        }
      }

      for (const input of instance.injectionInputs ?? []) {
        const renamedId = hubRenameMap.get(input.hubId)
        if (renamedId) {
          input.hubId = renamedId
        }
      }
    }

    for (const hub of blueprint.hubs) {
      for (const input of hub.inputs ?? []) {
        const renamedId = instanceRenameMap.get(input.instanceId)
        if (renamedId) {
          input.instanceId = renamedId
        }
      }

      for (const input of hub.injectionInputs ?? []) {
        const renamedId = hubRenameMap.get(input.hubId)
        if (renamedId) {
          input.hubId = renamedId
        }
      }
    }

    const blueprintNodeIdSet = new Set<string>()

    // create the nodes for the blueprint instances
    for (const instance of blueprint.instances) {
      await instancesStore.createBlueprintInstance(instance)

      const node = vueFlowStore.findNode(nodeFactory.instanceIdToNodeIdMap.get(instance.id)!)
      blueprintNodes.push(node!)
      blueprintNodeIdSet.add(node!.id)
    }

    // create the nodes for the blueprint hubs
    for (const hub of blueprint.hubs) {
      await instancesStore.createBlueprintHub(hub)

      const node = vueFlowStore.findNode(hub.id)
      blueprintNodes.push(node!)
      blueprintNodeIdSet.add(node!.id)
    }

    // create edges for the blueprint instances
    for (const instance of blueprint.instances) {
      nodeFactory.createEdgesForInstance(instance)
    }

    // create edges for the blueprint hubs
    for (const hub of blueprint.hubs) {
      nodeFactory.createEdgesForHub(hub)
    }

    for (const edge of vueFlowStore.edges.value) {
      if (blueprintNodeIdSet.has(edge.source) && blueprintNodeIdSet.has(edge.target)) {
        blueprintEdges.push(edge)
      }
    }

    // update the blueprint position based on the mouse position
    updateBlueprintPosition(blueprint)
  }

  const commitBlueprint = async (blueprint: Blueprint) => {
    // update positions of instances and hubs
    for (const node of blueprintNodes) {
      if (node.data.instance) {
        node.data.instance.position = node.position
      } else if (node.data.hub) {
        node.data.hub.position = node.position
      }
    }

    // write the blueprint to the backend
    // TODO: handle errors
    await instancesStore.createManyNodes(blueprint.instances, blueprint.hubs)

    // remove blueprint flags
    for (const node of blueprintNodes) {
      vueFlowStore.updateNodeData(node.id, { blueprint: false })
    }

    clearBlueprintState()
  }

  watch(blueprint, (newBlueprint, oldBlueprint) => {
    if (oldBlueprint && blueprint.value) {
      // clear the previous blueprint if it was not cleared
      clearBlueprint()
    }

    if (newBlueprint) {
      cursorMode.value = "blueprint"
      createBlueprint(newBlueprint)
    } else {
      cursorMode.value = "default"
    }
  })

  watch([blueprintCenter.x, blueprintCenter.y], () => {
    if (blueprint.value) {
      updateBlueprintPosition(blueprint.value)
    }
  })

  watch(escape, pressed => {
    if (pressed && blueprint.value) {
      // clear the current blueprint when escape is pressed
      clearBlueprint()
      blueprint.value = undefined
      cursorMode.value = "default"
    }
  })

  watch(mouseButton, () => {
    if (blueprint.value) {
      // commit the blueprint when the left mouse button is pressed/released
      commitBlueprint(blueprint.value)
      blueprint.value = undefined
      cursorMode.value = "default"
    }
  })
}
