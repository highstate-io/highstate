import { shallowReactive, shallowRef } from "vue"
import { describe, expect, test, vi } from "vitest"
import type { Edge, Node, VueFlowStore } from "@vue-flow/core"
import type { InstanceModel } from "@highstate/contract"
import { useNodeFactory } from "./node-factory"

vi.stubGlobal("globalLogger", {
  warn: vi.fn(),
  debug: vi.fn(),
})
vi.stubGlobal("shallowReactive", shallowReactive)

const createInstance = (name: string, inputs?: InstanceModel["inputs"]): InstanceModel => ({
  id: `test.component.v1:${name}`,
  kind: "unit",
  type: "test.component.v1",
  name,
  inputs,
  position: { x: 0, y: 0 },
})

const createVueFlowStore = () => {
  const nodes = shallowRef<Node[]>([])
  const edges = shallowRef<Edge[]>([])

  return {
    nodes,
    edges,
    addNodes: (node: Node) => nodes.value.push(node),
    addEdges: (edge: Edge) => edges.value.push(edge),
    findNode: (id?: string) => nodes.value.find(node => node.id === id),
    findEdge: (id: string) => edges.value.find(edge => edge.id === id),
    updateNode: (id: string, update: { position?: Node["position"] }) => {
      Object.assign(nodes.value.find(node => node.id === id)!, update)
    },
    updateNodeData: (id: string, data: Record<string, unknown>) => {
      Object.assign(nodes.value.find(node => node.id === id)!.data, data)
    },
    removeEdges: (id: string) => {
      edges.value = edges.value.filter(edge => edge.id !== id)
    },
  } as unknown as VueFlowStore
}

describe("useNodeFactory", () => {
  test("applies an authoritative instance update to its node", () => {
    const vueFlowStore = createVueFlowStore()
    const nodeFactory = useNodeFactory(vueFlowStore)
    const initialInstance = createInstance("target")
    const node = nodeFactory.createNodeFromInstance(initialInstance)
    const updatedInstance = {
      ...initialInstance,
      args: { refreshed: true },
      position: { x: 240, y: 180 },
    }

    nodeFactory.updateInstanceNode(updatedInstance)

    expect(vueFlowStore.findNode(node.id)?.position).toEqual({ x: 240, y: 180 })
    expect(vueFlowStore.findNode(node.id)?.data.instance.args).toEqual({ refreshed: true })
  })

  test("creates a connection from a new node to an existing instance after batch reconciliation", () => {
    const vueFlowStore = createVueFlowStore()
    const nodeFactory = useNodeFactory(vueFlowStore)
    const source = createInstance("source")
    const target = createInstance("target", {
      input: [{ instanceId: source.id, output: "result" }],
    })

    nodeFactory.createNodeFromInstance(target)
    expect(nodeFactory.createEdgesForInstance(target)).toEqual([])

    nodeFactory.createNodeFromInstance(source)
    nodeFactory.createEdgesForInstance(target)

    expect(vueFlowStore.edges.value).toEqual([
      expect.objectContaining({
        id: `${source.id}:result->${target.id}:input`,
        source: nodeFactory.instanceIdToNodeIdMap.get(source.id),
        target: nodeFactory.instanceIdToNodeIdMap.get(target.id),
      }),
    ])
  })
})
