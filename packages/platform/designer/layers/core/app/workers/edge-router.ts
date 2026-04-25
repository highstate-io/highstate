/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ConnEnd,
  ConnRef,
  Point,
  Rectangle,
  Router,
  ShapeRef,
  AvoidLib,
  default as initLibavoid,
} from "./libavoid/libavoid"

export type EdgeRouterShape = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type EdgeRouterEdge = {
  id: string
  source: string
  target: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

export type EdgeRouterInputMessage =
  | {
      type: "create-router"
      routerId: string
      shapes: EdgeRouterShape[]
      edges: EdgeRouterEdge[]
    }
  | {
      type: "add-shape" | "update-shape"
      routerId: string
      shape: EdgeRouterShape
    }
  | {
      type: "remove-shape"
      routerId: string
      shapeId: string
    }
  | {
      type: "add-edge" | "update-edge"
      routerId: string
      edge: EdgeRouterEdge
    }
  | {
      type: "remove-edge"
      routerId: string
      edgeId: string
    }
  | {
      type: "process-transaction"
      routerId: string
    }
  | {
      type: "dispose-router"
      routerId: string
    }

export type EdgeRouterOutputMessage =
  | {
      type: "router-ready"
      routerId: string
    }
  | {
      type: "edge-paths-updated"
      routerId: string
      updates: {
        edgeId: string
        points: number[][]
      }[]
    }

const postMessage = (port: MessagePort, message: EdgeRouterOutputMessage) => {
  port.postMessage(message)
}

const _avoid = initLibavoid("/libavoid.wasm").then(() => AvoidLib.getInstance())

type RouterState = {
  routerId: string
  router: Router
  shapeMap: Map<string, ShapeRef>
  edgeConnRefMap: Map<string, ConnRef>
}

const routers: Map<string, RouterState> = new Map()

const INITIAL_EDGE_CHUNK_SIZE = 150

const ROUTER_FLAG_ORTHOGONAL = 2

const ROUTING_PARAMETER = {
  SHAPE_BUFFER_DISTANCE: 6,
  IDEAL_NUDGING_DISTANCE: 7,
} as const

const ROUTING_OPTION = {
  NUDGE_ORTHOGONAL_SEGMENTS: 0,
  NUDGE_ORTHOGONAL_TOUCHING_COLINEAR_SEGMENTS: 3,
  PERFORM_UNIFYING_NUDGING_PREPROCESSING_STEP: 4,
  NUDGE_SHARED_PATHS_WITH_COMMON_END_POINT: 6,
  NUDGE_ORTHOGONAL_SEGMENTS_CONNECTED_TO_SHAPES: 7,
} as const

const CONN_DIR_LEFT = 4
const CONN_DIR_RIGHT = 8

const waitForNextTask = async (): Promise<void> => {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0)
  })
}

const createInitialEdges = async (
  port: MessagePort,
  state: RouterState,
  edges: EdgeRouterEdge[],
): Promise<void> => {
  if (edges.length <= INITIAL_EDGE_CHUNK_SIZE) {
    for (const edge of edges) {
      addEdge(port, state, edge)
    }

    state.router.processTransaction()
    sendAllEdgePathUpdates(port, state)
    return
  }

  for (let startIndex = 0; startIndex < edges.length; startIndex += INITIAL_EDGE_CHUNK_SIZE) {
    const edgeChunk = edges.slice(startIndex, startIndex + INITIAL_EDGE_CHUNK_SIZE)

    for (const edge of edgeChunk) {
      addEdge(port, state, edge)
    }

    state.router.processTransaction()
    sendAllEdgePathUpdates(port, state)

    await waitForNextTask()
  }
}

const createRouter = async (
  port: MessagePort,
  routerId: string,
  shapes: EdgeRouterShape[],
  edges: EdgeRouterEdge[],
): Promise<void> => {
  if (routers.has(routerId)) {
    console.warn(`router with id "${routerId}" already exists`)
    return
  }

  await _avoid

  const router: Router = new Router(ROUTER_FLAG_ORTHOGONAL)

  router.setRoutingParameter(ROUTING_PARAMETER.IDEAL_NUDGING_DISTANCE, 6)
  router.setRoutingParameter(ROUTING_PARAMETER.SHAPE_BUFFER_DISTANCE, 40)
  router.setRoutingOption(ROUTING_OPTION.NUDGE_ORTHOGONAL_SEGMENTS, true)
  router.setRoutingOption(ROUTING_OPTION.NUDGE_ORTHOGONAL_TOUCHING_COLINEAR_SEGMENTS, true)
  router.setRoutingOption(ROUTING_OPTION.PERFORM_UNIFYING_NUDGING_PREPROCESSING_STEP, true)
  router.setRoutingOption(ROUTING_OPTION.NUDGE_SHARED_PATHS_WITH_COMMON_END_POINT, false)
  // router.setRoutingOption(ROUTING_OPTION.NUDGE_ORTHOGONAL_SEGMENTS_CONNECTED_TO_SHAPES, true)

  const state: RouterState = {
    routerId,
    router,
    shapeMap: new Map(),
    edgeConnRefMap: new Map(),
  }
  routers.set(routerId, state)

  console.log(
    `router with id "${routerId}" created with ${shapes.length} shapes and ${edges.length} edges`,
  )

  for (const shape of shapes) {
    addShape(state, shape)
  }

  await createInitialEdges(port, state, edges)

  postMessage(port, { type: "router-ready", routerId })
}

const getAvoidRectFromShape = (shape: EdgeRouterShape): Rectangle => {
  return Rectangle.fromCorners(
    new Point(shape.x, shape.y),
    new Point(shape.x + shape.width, shape.y + shape.height),
  )
}

const addShape = (state: RouterState, shape: EdgeRouterShape): void => {
  const avoidRect = getAvoidRectFromShape(shape)
  const shapeRef = new ShapeRef(state.router, avoidRect.toPolygon())
  state.router.addShape(shapeRef)

  state.shapeMap.set(shape.id, shapeRef)
}

const updateShape = (state: RouterState, shape: EdgeRouterShape): void => {
  const shapeRef = state.shapeMap.get(shape.id)

  if (shapeRef) {
    const avoidRect = getAvoidRectFromShape(shape)
    state.router.moveShapeTo(shapeRef, avoidRect.toPolygon())
  } else {
    addShape(state, shape)
  }
}

const getEdgePath = (state: RouterState, connRef: ConnRef): number[][] => {
  const route = state.router.getConnectorRoute(connRef.id()) ?? connRef.displayRoute()

  if (!route) {
    return []
  }

  const points: number[][] = []

  for (let i = 0; i < route.size(); i++) {
    const routePoint = route.at(i)
    if (!routePoint) {
      continue
    }

    points.push([routePoint.x, routePoint.y])
  }

  return points
}

const sendAllEdgePathUpdates = (port: MessagePort, state: RouterState): void => {
  const updates = Array.from(state.edgeConnRefMap.entries()).map(([edgeId, connRef]) => ({
    edgeId,
    points: getEdgePath(state, connRef),
  }))

  postMessage(port, {
    type: "edge-paths-updated",
    routerId: state.routerId,
    updates,
  })
}

const removeShape = (state: RouterState, shapeId: string): void => {
  const shapeRef = state.shapeMap.get(shapeId)

  if (shapeRef) {
    state.router.deleteShape(shapeRef)
    state.shapeMap.delete(shapeId)
  }
}

const getEdgeEndpoints = (edge: EdgeRouterEdge) => {
  const srcPt = new Point(edge.sourceX, edge.sourceY)
  const dstPt = new Point(edge.targetX, edge.targetY)

  const srcConnEnd = new ConnEnd(srcPt, CONN_DIR_RIGHT)
  const dstConnEnd = new ConnEnd(dstPt, CONN_DIR_LEFT)

  return { srcConnEnd, dstConnEnd }
}

const addEdge = (port: MessagePort, state: RouterState, edge: EdgeRouterEdge): void => {
  const sourceNodeShape = state.shapeMap.get(edge.source)
  const targetNodeShape = state.shapeMap.get(edge.target)

  if (sourceNodeShape && targetNodeShape) {
    const { srcConnEnd, dstConnEnd } = getEdgeEndpoints(edge)

    const connRef: ConnRef = ConnRef.createWithEndpoints(state.router, srcConnEnd, dstConnEnd)
    connRef.setRoutingType(ROUTER_FLAG_ORTHOGONAL)
    state.router.addConnector(connRef)

    state.edgeConnRefMap.set(edge.id, connRef)
  }
}

const updateEdge = (state: RouterState, edge: EdgeRouterEdge): void => {
  const connRef = state.edgeConnRefMap.get(edge.id)
  if (connRef) {
    const { srcConnEnd, dstConnEnd } = getEdgeEndpoints(edge)

    connRef.setSourceEndpoint(srcConnEnd)
    connRef.setDestEndpoint(dstConnEnd)
    state.router.updateConnector(connRef)
  }
}

const removeEdge = (state: RouterState, edgeId: string): void => {
  const connRef = state.edgeConnRefMap.get(edgeId)
  if (connRef) {
    state.router.deleteConnector(connRef)
    state.edgeConnRefMap.delete(edgeId)
  }
}

const disposeRouter = (routerId: string): void => {
  const state = routers.get(routerId)
  if (!state) {
    return
  }

  state.edgeConnRefMap.clear()
  state.shapeMap.clear()
  routers.delete(routerId)
}

const withRouter = (routerId: string, callback: (state: RouterState) => void): void => {
  const state = routers.get(routerId)
  if (!state) {
    console.warn(`router with id "${routerId}" not found`)
    return
  }

  callback(state)
}

;(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const port = event.ports[0]

  console.debug("EdgeRouter worker connected", { event })

  port.onmessage = (event: MessageEvent<EdgeRouterInputMessage>) => {
    const data = event.data

    switch (data.type) {
      case "create-router": {
        createRouter(port, data.routerId, data.shapes, data.edges)
        break
      }
      case "add-shape": {
        withRouter(data.routerId, state => addShape(state, data.shape))
        break
      }
      case "update-shape": {
        withRouter(data.routerId, state => updateShape(state, data.shape))
        break
      }
      case "remove-shape": {
        withRouter(data.routerId, state => removeShape(state, data.shapeId))
        break
      }
      case "add-edge": {
        withRouter(data.routerId, state => addEdge(port, state, data.edge))
        break
      }
      case "update-edge": {
        withRouter(data.routerId, state => updateEdge(state, data.edge))
        break
      }
      case "remove-edge": {
        withRouter(data.routerId, state => removeEdge(state, data.edgeId))
        break
      }
      case "process-transaction": {
        withRouter(data.routerId, state => {
          state.router.processTransaction()
          sendAllEdgePathUpdates(port, state)
        })
        break
      }
      case "dispose-router": {
        disposeRouter(data.routerId)
        break
      }
    }
  }
}

console.debug("EdgeRouter worker ready")
