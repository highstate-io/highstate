import type { InputResolverOutput } from "@highstate/backend/shared"
import { getResolvedHubInputs, getResolvedInstanceInputs } from "@highstate/backend/shared"
import type { HubModel, InstanceModel } from "@highstate/contract"
import type { EdgeChange, GraphEdge, GraphNode, VueFlowStore } from "@vue-flow/core"
import type { EventHookOn } from "@vueuse/core"

export type RoutedEdgeEndpoints = {
  routedSourceY?: number
  routedTargetY?: number
}

export type RoutedEdgeData = RoutedEdgeEndpoints & {
  hubReservedGhostLane?: boolean
  isPendingHubTyped?: boolean
  points?: number[][]
}

type NodeKind = "hub" | "instance" | "other"

type NodeModels = {
  hub?: HubModel
  instance?: InstanceModel
}

type GroupKey = string

type IndexedEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  sourceKind: NodeKind
  targetKind: NodeKind
  weight: number
  hubId?: string
  sourceGroupKey?: GroupKey
  targetGroupKey?: GroupKey
}

const BASE_LANE_PITCH_PX = 6

// Must match the visual height of the connection point (handle dot).
// When there are too many lanes, we shrink the pitch so lanes overlap instead of exceeding this height.
const CONNECTION_POINT_HEIGHT_PX = 20

const getNodeKind = (node: GraphNode): NodeKind => {
  if (node.type === "hub") {
    return "hub"
  }

  const data = node.data as NodeModels
  if (data.hub) {
    return "hub"
  }

  if (data.instance) {
    return "instance"
  }

  return "other"
}

const getNodeModels = (node: GraphNode): NodeModels => {
  return node.data as NodeModels
}

const normalizeHandleId = (handleId: unknown): string => {
  if (typeof handleId === "string") {
    return handleId
  }

  return ""
}

const countUnique = (values: string[]): number => {
  const set = new Set(values)
  return set.size
}

const getHubBundleEntitySlots = (
  inputResolverOutputs: ReadonlyMap<string, InputResolverOutput> | undefined,
  hubId: string,
): number => {
  if (!inputResolverOutputs) {
    return 0
  }

  const types = getResolvedHubInputs(inputResolverOutputs, hubId).map(input => input.type)
  return countUnique(types)
}

const buildSourceGroupKey = (edge: IndexedEdge): GroupKey => {
  return `src:${edge.source}:${edge.sourceHandle}`
}

const buildTargetGroupKey = (edge: IndexedEdge): GroupKey => {
  return `tgt:${edge.target}:${edge.targetHandle}`
}

const buildHubTargetGroupKey = (edge: IndexedEdge): GroupKey => {
  return `hub-tgt:${edge.target}`
}

export function useCanvasEdgeEndpointOffsets(
  vueFlowStore: VueFlowStore,
  onNodesMoved: EventHookOn<[GraphNode[], GraphEdge[]]>,
) {
  const inputResolverOutputs = shallowRef<ReadonlyMap<string, InputResolverOutput>>()

  const edgeIndex = shallowReactive(new Map<string, IndexedEdge>())
  const groups = shallowReactive(new Map<GroupKey, Set<string>>())

  const hubOutgoingEdgeIds = shallowReactive(new Map<string, Set<string>>())

  const dirtyGroups = new Set<GroupKey>()
  let scheduled = false

  const { on: onOffsetsUpdated, trigger: triggerOffsetsUpdated } = createEventHook<[string[]]>()

  const addOutgoingHubEdge = (hubId: string, edgeId: string) => {
    const existing = hubOutgoingEdgeIds.get(hubId)

    if (existing) {
      existing.add(edgeId)
      return
    }

    hubOutgoingEdgeIds.set(hubId, new Set([edgeId]))
  }

  const removeOutgoingHubEdge = (hubId: string, edgeId: string) => {
    const existing = hubOutgoingEdgeIds.get(hubId)
    if (!existing) {
      return
    }

    existing.delete(edgeId)
    if (existing.size === 0) {
      hubOutgoingEdgeIds.delete(hubId)
    }
  }

  const addToGroup = (groupKey: GroupKey, edgeId: string) => {
    const existing = groups.get(groupKey)

    if (existing) {
      existing.add(edgeId)
      return
    }

    groups.set(groupKey, new Set([edgeId]))
  }

  const removeFromGroup = (groupKey: GroupKey, edgeId: string) => {
    const existing = groups.get(groupKey)
    if (!existing) {
      return
    }

    existing.delete(edgeId)

    if (existing.size === 0) {
      groups.delete(groupKey)
    }
  }

  const unindexEdge = (edgeId: string) => {
    const indexed = edgeIndex.get(edgeId)
    if (!indexed) {
      return
    }

    if (indexed.hubId) {
      removeOutgoingHubEdge(indexed.hubId, edgeId)
    }

    if (indexed.sourceGroupKey) {
      removeFromGroup(indexed.sourceGroupKey, edgeId)
      dirtyGroups.add(indexed.sourceGroupKey)
    }

    if (indexed.targetGroupKey) {
      removeFromGroup(indexed.targetGroupKey, edgeId)
      dirtyGroups.add(indexed.targetGroupKey)
    }

    edgeIndex.delete(edgeId)
  }

  const computeIsPendingHubTypedEdge = (edge: GraphEdge, indexed: IndexedEdge): boolean => {
    if (indexed.sourceKind !== "hub") {
      return false
    }

    if (indexed.targetKind !== "instance") {
      return false
    }

    if (indexed.targetHandle.length === 0) {
      return false
    }

    const outputs = inputResolverOutputs.value
    if (!outputs) {
      return true
    }

    const targetNode = vueFlowStore.findNode(edge.target)
    if (!targetNode) {
      return true
    }

    const models = getNodeModels(targetNode)
    if (!models.instance) {
      return false
    }

    const resolved = getResolvedInstanceInputs(outputs, models.instance.id)
    const matches = resolved[indexed.targetHandle] ?? []

    return matches.length === 0
  }

  const recomputeHubState = (hubId: string) => {
    const edgeIds = hubOutgoingEdgeIds.get(hubId)
    if (!edgeIds || edgeIds.size === 0) {
      return
    }

    let hasPendingTyped = false

    for (const edgeId of edgeIds) {
      const indexed = edgeIndex.get(edgeId)
      const edge = vueFlowStore.findEdge(edgeId)
      if (!indexed || !edge) {
        continue
      }

      if (computeIsPendingHubTypedEdge(edge, indexed)) {
        hasPendingTyped = true
        break
      }
    }

    const outputs = inputResolverOutputs.value
    const entitySlots = getHubBundleEntitySlots(outputs, hubId)
    const baseSlots = Math.max(1, entitySlots)
    const totalSlots = baseSlots + (hasPendingTyped && entitySlots > 0 ? 1 : 0)

    for (const edgeId of edgeIds) {
      const indexed = edgeIndex.get(edgeId)
      const edge = vueFlowStore.findEdge(edgeId)
      if (!indexed || !edge) {
        continue
      }

      const isPendingHubTyped = computeIsPendingHubTypedEdge(edge, indexed)

      const isHubTypedToComponentInput =
        indexed.targetKind === "instance" && indexed.targetHandle.length > 0

      const desiredWeight = isHubTypedToComponentInput ? 1 : totalSlots

      if (indexed.weight !== desiredWeight) {
        indexed.weight = desiredWeight
        markEdgeDirty(edgeId)
      }

      const current = (edge.data ?? {}) as RoutedEdgeData
      const nextPatch: Partial<RoutedEdgeData> = {}

      if (current.hubReservedGhostLane !== hasPendingTyped) {
        nextPatch.hubReservedGhostLane = hasPendingTyped
      }

      if (current.isPendingHubTyped !== isPendingHubTyped) {
        nextPatch.isPendingHubTyped = isPendingHubTyped
      }

      if (Object.keys(nextPatch).length > 0) {
        vueFlowStore.updateEdgeData(edgeId, nextPatch)
      }
    }
  }

  const indexEdge = (edge: GraphEdge) => {
    const sourceNode = vueFlowStore.findNode(edge.source)
    const targetNode = vueFlowStore.findNode(edge.target)

    if (!sourceNode || !targetNode) {
      return
    }

    const sourceKind = getNodeKind(sourceNode)
    const targetKind = getNodeKind(targetNode)

    const sourceHandle = normalizeHandleId(edge.sourceHandle)
    const targetHandle = normalizeHandleId(edge.targetHandle)

    const weight = 1

    const indexed: IndexedEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle,
      targetHandle,
      sourceKind,
      targetKind,
      weight,
    }

    if (sourceKind === "hub") {
      indexed.hubId = edge.source
      addOutgoingHubEdge(edge.source, edge.id)
    }

    if (sourceKind === "instance") {
      indexed.sourceGroupKey = buildSourceGroupKey(indexed)
      addToGroup(indexed.sourceGroupKey, edge.id)
      dirtyGroups.add(indexed.sourceGroupKey)
    }

    if (targetKind === "instance") {
      indexed.targetGroupKey = buildTargetGroupKey(indexed)
      addToGroup(indexed.targetGroupKey, edge.id)
      dirtyGroups.add(indexed.targetGroupKey)
    } else if (targetKind === "hub") {
      indexed.targetGroupKey = buildHubTargetGroupKey(indexed)
      addToGroup(indexed.targetGroupKey, edge.id)
      dirtyGroups.add(indexed.targetGroupKey)
    }

    edgeIndex.set(edge.id, indexed)
  }

  const markEdgeDirty = (edgeId: string) => {
    const indexed = edgeIndex.get(edgeId)
    if (!indexed) {
      return
    }

    if (indexed.sourceGroupKey) {
      dirtyGroups.add(indexed.sourceGroupKey)
    }

    if (indexed.targetGroupKey) {
      dirtyGroups.add(indexed.targetGroupKey)
    }
  }

  const markNodeDirty = (nodeId: string) => {
    const edges = vueFlowStore.getConnectedEdges(nodeId)
    for (const edge of edges) {
      markEdgeDirty(edge.id)
    }
  }

  const recomputeGroup = (groupKey: GroupKey): string[] => {
    const edgeIds = groups.get(groupKey)
    if (!edgeIds || edgeIds.size === 0) {
      return []
    }

    const indexedEdges: IndexedEdge[] = []
    for (const edgeId of edgeIds) {
      const indexed = edgeIndex.get(edgeId)
      if (indexed) {
        indexedEdges.push(indexed)
      }
    }

    indexedEdges.sort((a, b) => a.id.localeCompare(b.id))

    const totalLanes = indexedEdges.reduce((sum, item) => sum + Math.max(1, item.weight), 0)
    const globalCenter = (totalLanes - 1) / 2

    const pitchPx =
      totalLanes <= 1
        ? BASE_LANE_PITCH_PX
        : Math.min(BASE_LANE_PITCH_PX, CONNECTION_POINT_HEIGHT_PX / (totalLanes - 1))

    let cursor = 0
    const updatedEdgeIds: string[] = []

    for (const item of indexedEdges) {
      const weight = Math.max(1, item.weight)
      const laneCenter = cursor + (weight - 1) / 2
      const deltaY = (laneCenter - globalCenter) * pitchPx

      cursor += weight

      const edge = vueFlowStore.findEdge(item.id)
      if (!edge) {
        continue
      }

      const patch: RoutedEdgeEndpoints = {}

      if (groupKey.startsWith("src:")) {
        if (Number.isFinite(edge.sourceY)) {
          patch.routedSourceY = edge.sourceY + deltaY
        }
      } else {
        if (Number.isFinite(edge.targetY)) {
          patch.routedTargetY = edge.targetY + deltaY
        }
      }

      const current = (edge.data ?? {}) as RoutedEdgeData
      const routedSourceYChanged =
        patch.routedSourceY !== undefined && patch.routedSourceY !== current.routedSourceY
      const routedTargetYChanged =
        patch.routedTargetY !== undefined && patch.routedTargetY !== current.routedTargetY

      if (routedSourceYChanged || routedTargetYChanged) {
        vueFlowStore.updateEdgeData(edge.id, patch)
        updatedEdgeIds.push(edge.id)
      }
    }

    return updatedEdgeIds
  }

  const flush = () => {
    scheduled = false

    if (dirtyGroups.size === 0) {
      return
    }

    const updated: string[] = []

    for (const groupKey of dirtyGroups) {
      updated.push(...recomputeGroup(groupKey))
    }

    dirtyGroups.clear()

    if (updated.length > 0) {
      triggerOffsetsUpdated(updated)
    }
  }

  const scheduleFlush = () => {
    if (scheduled) {
      return
    }

    scheduled = true

    requestAnimationFrame(() => {
      flush()
    })
  }

  const ensureIndexed = () => {
    if (edgeIndex.size > 0 || vueFlowStore.edges.value.length === 0) {
      return
    }

    for (const edge of vueFlowStore.edges.value) {
      indexEdge(edge)
    }

    scheduleFlush()
  }

  vueFlowStore.onEdgesChange((changes: EdgeChange[]) => {
    const hubsToRecompute = new Set<string>()

    for (const change of changes) {
      if (change.type === "add") {
        indexEdge(change.item)

        const indexed = edgeIndex.get(change.item.id)
        if (indexed?.hubId) {
          hubsToRecompute.add(indexed.hubId)
        }
      } else if (change.type === "remove") {
        const indexed = edgeIndex.get(change.id)
        if (indexed?.hubId) {
          hubsToRecompute.add(indexed.hubId)
        }

        unindexEdge(change.id)
      }
    }

    for (const hubId of hubsToRecompute) {
      recomputeHubState(hubId)
    }

    scheduleFlush()
  })

  vueFlowStore.onNodesChange(changes => {
    for (const change of changes) {
      if (change.type === "position" || change.type === "dimensions") {
        markNodeDirty(change.id)
      }
    }

    scheduleFlush()
  })

  onNodesMoved(nodes => {
    for (const node of nodes) {
      markNodeDirty(node.id)
    }

    scheduleFlush()
  })

  const setInputResolverOutputs = (outputs: ReadonlyMap<string, InputResolverOutput>) => {
    inputResolverOutputs.value = outputs

    for (const hubId of hubOutgoingEdgeIds.keys()) {
      recomputeHubState(hubId)
    }

    scheduleFlush()
  }

  ensureIndexed()

  return {
    onOffsetsUpdated,
    setInputResolverOutputs,
    ensureIndexed,
  }
}
