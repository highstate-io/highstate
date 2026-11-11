import { readFileSync } from "node:fs"
import {
  ConnEnd,
  ConnRef,
  initSync,
  Point,
  Rectangle,
  Router,
  ShapeRef,
} from "../layers/core/app/workers/libavoid/libavoid.js"

initSync({ module: readFileSync(new URL("../public/libavoid.wasm", import.meta.url)) })

const scenario = process.argv[2]
const flags = Number(process.argv[3] ?? 2)
const router = new Router(flags)
router.setRoutingParameter(6, 40)
router.setRoutingParameter(7, 6)
router.setRoutingOption(0, true)
router.setRoutingOption(3, true)
router.setRoutingOption(4, true)
router.setRoutingOption(6, false)

const rectangle = (x: number, y: number, width: number, height: number) =>
  Rectangle.fromCorners(new Point(x, y), new Point(x + width, y + height)).toPolygon()

const shapes: ShapeRef[] = []
const addShape = (x: number, y: number, width: number, height: number) => {
  const shape = new ShapeRef(router, rectangle(x, y, width, height))
  router.addShape(shape)
  shapes.push(shape)
  return shape
}

const connect = (routingType = 2) => {
  const connection = ConnRef.createWithEndpoints(
    router,
    new ConnEnd(new Point(0, 100), 8),
    new ConnEnd(new Point(500, 100), 4),
  )

  connection.setRoutingType(routingType)
  router.addConnector(connection)
  return connection
}

const readRoute = (connection: ConnRef) => {
  const polygon = router.getConnectorRoute(connection.id())
  const points: number[][] = []

  if (polygon) {
    for (let index = 0; index < polygon.size(); index++) {
      const point = polygon.at(index)
      if (point) {
        points.push([point.x, point.y])
      }
    }
  }

  return points
}

const route = (connection: ConnRef) => {
  router.processTransaction()
  return readRoute(connection)
}

if (scenario === "large") {
  for (let index = 0; index < 798; index++) {
    addShape(600, index * 400, 360, 294.625)
  }

  // A shape-only transaction reproduces the unused-visibility-graph regression.
  router.processTransaction()
  const points = route(connect())
  console.log(JSON.stringify({ shapes: shapes.length, points }))
} else if (scenario === "detour") {
  addShape(200, 0, 100, 200)
  console.log(JSON.stringify({ points: route(connect()) }))
} else if (scenario === "lifecycle") {
  const obstacle = addShape(200, 300, 100, 200)
  const connection = connect()
  const before = route(connection)
  router.moveShapeTo(obstacle, rectangle(200, 0, 100, 200))
  const moved = route(connection)
  router.deleteShape(obstacle)
  const removed = route(connection)
  console.log(JSON.stringify({ before, moved, removed }))
} else if (scenario === "polyline") {
  addShape(200, 0, 100, 200)
  // process first: a polyline connector added later must see current obstacles
  router.processTransaction()
  console.log(JSON.stringify({ points: route(connect(1)) }))
} else if (scenario === "dense") {
  for (let index = 0; index < 200; index++) {
    addShape(600, index * 400, 360, 295)
  }

  const connections = Array.from({ length: 256 }, (_, index) => {
    const source = new Point(364.75, index / 100)
    const target = new Point(595, (100 + (index % 100)) * 400 + 200)

    const connection = ConnRef.createWithEndpoints(
      router,
      new ConnEnd(source, 8),
      new ConnEnd(target, 4),
    )

    connection.setRoutingType(2)
    router.addConnector(connection)
    return connection
  })

  router.processTransaction()
  const paths = connections.map(readRoute)

  const endpointsPreserved = paths.every(
    (points, index) =>
      points.length >= 2 &&
      points[0][0] === 364.75 &&
      points[0][1] === index / 100 &&
      points.at(-1)![0] === 595 &&
      points.at(-1)![1] === (100 + (index % 100)) * 400 + 200,
  )

  const orthogonal = paths.every(points =>
    points.every(
      (point, index) =>
        index === 0 || point[0] === points[index - 1][0] || point[1] === points[index - 1][1],
    ),
  )

  console.log(
    JSON.stringify({
      routed: paths.filter(points => points.length >= 2).length,
      endpointsPreserved,
      orthogonal,
      finite: paths.every(points => points.flat().every(Number.isFinite)),
    }),
  )
} else {
  throw new Error(`Unknown routing fixture "${scenario}"`)
}
