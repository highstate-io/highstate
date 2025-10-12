import { layout, graphlib } from "@dagrejs/dagre"

export type InputNode = {
  id: string
  width: number
  height: number
}

export type InputEdge = {
  source: string
  target: string
}

export type LayoutInput = {
  requestId: string
  nodes: InputNode[]
  edges: InputEdge[]
}

export type OutputNode = {
  id: string
  x: number
  y: number
}

export type LayoutOutput = {
  requestId: string
  nodes: OutputNode[]
}
;(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const port = event.ports[0]

  port.onmessage = (event: MessageEvent<LayoutInput>) => {
    const graph = new graphlib.Graph()

    graph.setDefaultEdgeLabel(() => ({}))
    graph.setGraph({ rankdir: "LR", ranksep: 200, nodesep: 150 })

    for (const node of event.data.nodes) {
      graph.setNode(node.id, { width: node.width, height: node.height })
    }

    for (const edge of event.data.edges) {
      graph.setEdge(edge.source, edge.target)
    }

    layout(graph)

    const nodes: OutputNode[] = event.data.nodes.map(node => {
      const graphNode = graph.node(node.id)

      return {
        id: node.id,
        x: graphNode.x - node.width / 2,
        y: graphNode.y - node.height / 2,
      }
    })

    const output: LayoutOutput = {
      requestId: event.data.requestId,
      nodes,
    }

    port.postMessage(output)
  }
}
