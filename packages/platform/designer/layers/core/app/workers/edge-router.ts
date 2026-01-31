/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  AvoidLib,
  type Avoid,
  type ConnRef,
  type Rectangle,
  type Router,
  type ShapeRef,
} from "libavoid-js"

// thanks to https://github.com/clientIO/joint/blob/master/examples/libavoid/src/avoid-router.js

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
      type: "edge-path-updated"
      routerId: string
      edgeId: string
      points: number[][]
    }

const postMessage = (port: MessagePort, message: EdgeRouterOutputMessage) => {
  port.postMessage(message)
}

const _avoid = AvoidLib.load("/libavoid.wasm").then(() => AvoidLib.getInstance())

type RouterState = {
  routerId: string
  router: Router
  shapeMap: Map<string, ShapeRef>
  edgeConnRefMap: Map<string, ConnRef>
  avoid: Avoid
}

const routers: Map<string, RouterState> = new Map()

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

  const avoid = await _avoid

  const router: Router = new avoid.Router(avoid.OrthogonalRouting)

  router.setRoutingParameter(avoid.idealNudgingDistance, 6)
  router.setRoutingParameter(avoid.shapeBufferDistance, 40)
  router.setRoutingOption(avoid.nudgeOrthogonalTouchingColinearSegments, true)
  router.setRoutingOption(avoid.performUnifyingNudgingPreprocessingStep, true)
  router.setRoutingOption(avoid.nudgeSharedPathsWithCommonEndPoint, false)

  const state = { routerId, router, shapeMap: new Map(), edgeConnRefMap: new Map(), avoid }
  routers.set(routerId, state)

  console.log(
    `router with id "${routerId}" created with ${shapes.length} shapes and ${edges.length} edges`,
  )

  for (const shape of shapes) {
    addShape(state, shape)
  }

  for (const edge of edges) {
    addEdge(port, state, edge)
  }

  router.processTransaction()

  for (const edge of edges) {
    const connRef = state.edgeConnRefMap.get(edge.id)
    if (connRef) {
      syncEdgePath(port, state, edge.id, connRef)
    }
  }

  postMessage(port, { type: "router-ready", routerId })
}

const getAvoidRectFromShape = (avoid: Avoid, shape: EdgeRouterShape): Rectangle => {
  return new avoid.Rectangle(
    new avoid.Point(shape.x, shape.y),
    new avoid.Point(shape.x + shape.width, shape.y + shape.height),
  )
}

const addShape = (state: RouterState, shape: EdgeRouterShape): void => {
  const avoidRect = getAvoidRectFromShape(state.avoid, shape)
  const shapeRef = new state.avoid.ShapeRef(state.router, avoidRect)

  state.shapeMap.set(shape.id, shapeRef)
}

const updateShape = (state: RouterState, shape: EdgeRouterShape): void => {
  const shapeRef = state.shapeMap.get(shape.id)

  if (shapeRef) {
    const avoidRect = getAvoidRectFromShape(state.avoid, shape)

    state.router.moveShape(shapeRef, avoidRect)
  } else {
    addShape(state, shape)
  }
}

const syncEdgePath = (
  port: MessagePort,
  state: RouterState,
  edgeId: string,
  connRef: ConnRef,
): void => {
  const route = connRef.displayRoute()
  const points: number[][] = []

  for (let i = 0; i < route.size(); i++) {
    points.push([route.get_ps(i).x, route.get_ps(i).y])
  }

  postMessage(port, {
    type: "edge-path-updated",
    routerId: state.routerId,
    edgeId,
    points,
  })
}

const createConnCallback = (
  port: MessagePort,
  state: RouterState,
  edgeId: string,
): ((connRefPtr: number) => void) => {
  return (connRefPtr: number) => {
    const connRef = state.avoid.wrapPointer(connRefPtr, state.avoid.ConnRef)

    syncEdgePath(port, state, edgeId, connRef)
  }
}

const removeShape = (state: RouterState, shapeId: string): void => {
  const shapeRef = state.shapeMap.get(shapeId)

  if (shapeRef) {
    state.router.deleteShape(shapeRef)
    state.shapeMap.delete(shapeId)
  }
}

const getEdgeEndpoints = (avoid: Avoid, edge: EdgeRouterEdge) => {
  const srcPt: any = new avoid.Point(edge.sourceX, edge.sourceY)
  const dstPt: any = new avoid.Point(edge.targetX, edge.targetY)

  const srcConnEnd = new avoid.ConnEnd(srcPt, avoid.ConnDirRight)
  const dstConnEnd = new avoid.ConnEnd(dstPt, avoid.ConnDirLeft)

  return { srcConnEnd, dstConnEnd }
}

const addEdge = (port: MessagePort, state: RouterState, edge: EdgeRouterEdge): void => {
  const sourceNodeShape = state.shapeMap.get(edge.source)
  const targetNodeShape = state.shapeMap.get(edge.target)

  if (sourceNodeShape && targetNodeShape) {
    const { srcConnEnd, dstConnEnd } = getEdgeEndpoints(state.avoid, edge)

    const connRef: ConnRef = new state.avoid.ConnRef(state.router, srcConnEnd, dstConnEnd)

    connRef.setCallback(createConnCallback(port, state, edge.id), connRef)
    state.edgeConnRefMap.set(edge.id, connRef)
  }
}

const updateEdge = (state: RouterState, edge: EdgeRouterEdge): void => {
  const connRef = state.edgeConnRefMap.get(edge.id)
  if (connRef) {
    const { srcConnEnd, dstConnEnd } = getEdgeEndpoints(state.avoid, edge)

    connRef.setSourceEndpoint(srcConnEnd)
    connRef.setDestEndpoint(dstConnEnd)
  }
}

const removeEdge = (state: RouterState, edgeId: string): void => {
  const connRef = state.edgeConnRefMap.get(edgeId)
  if (connRef) {
    state.router.deleteConnector(connRef)
    state.edgeConnRefMap.delete(edgeId)
  }
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
        })
        break
      }
    }
  }
}

console.debug("EdgeRouter worker ready")
