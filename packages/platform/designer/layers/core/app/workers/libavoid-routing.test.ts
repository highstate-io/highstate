import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL("../../../../scripts/libavoid-fixture.ts", import.meta.url))
type Point = [number, number]
type Result = {
  shapes?: number
  points: Point[]
  before: Point[]
  moved: Point[]
  removed: Point[]
  routed?: number
  endpointsPreserved?: boolean
  orthogonal?: boolean
  finite?: boolean
  paths?: Point[][]
}

const run = async (scenario: string, flags = 2): Promise<Result> => {
  // keep synchronous WASM in a killable process: a Vitest timer cannot interrupt it
  const { stdout } = await execute(process.execPath, [fixture, scenario, String(flags)], {
    timeout: 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 1_000_000,
  })

  return JSON.parse(stdout)
}

const expectEndpoints = (points: Point[]) => {
  expect(points.length).toBeGreaterThanOrEqual(2)
  expect(points[0]).toEqual([0, 100])
  expect(points.at(-1)).toEqual([500, 100])
  expect(points.flat().every(Number.isFinite)).toBe(true)
}

const expectOrthogonal = (points: Point[]) => {
  expectEndpoints(points)

  for (let index = 1; index < points.length; index++) {
    const [x, y] = points[index]
    const [previousX, previousY] = points[index - 1]
    expect(x === previousX || y === previousY).toBe(true)
  }
}

const expectObstacleClearance = (
  points: Point[],
  buffer: number,
  obstacle = [200, 0, 300, 200],
) => {
  const epsilon = 1e-7

  const bounds = [
    [obstacle[0] - buffer + epsilon, obstacle[2] + buffer - epsilon],
    [obstacle[1] - buffer + epsilon, obstacle[3] + buffer - epsilon],
  ]

  for (let index = 1; index < points.length; index++) {
    let from = 0,
      to = 1

    for (let dimension = 0; dimension < 2; dimension++) {
      const origin = points[index - 1][dimension]
      const delta = points[index][dimension] - origin
      const [minimum, maximum] = bounds[dimension]

      if (delta === 0) {
        if (origin < minimum || origin > maximum) {
          from = 1
          to = 0
          break
        }
      } else {
        const a = (minimum - origin) / delta,
          b = (maximum - origin) / delta

        from = Math.max(from, Math.min(a, b))
        to = Math.min(to, Math.max(a, b))
      }
    }

    expect(to <= from).toBe(true)
  }
}

describe("vendored libavoid routing", () => {
  test.each([
    ["horizontal", 0],
    ["vertical", 0],
    ["horizontal", 40],
    ["vertical", 40],
  ] as const)("nudges %s channels away from obstacles with buffer %i", async (axis, buffer) => {
    const { paths } = await run(`channel-${buffer ? "buffered-" : ""}${axis}`)
    const vertical = axis === "vertical"
    const project = ([x, y]: Point): Point => (vertical ? [y, x] : [x, y])
    const normalized = paths!.map(path => path.map(project))

    for (const [index, points] of normalized.entries()) {
      expect(points[0]).toEqual([0, 1080 + index * 20])
      expect(points.at(-1)).toEqual([500, 1080 + index * 20])
      expect(points.flat().every(Number.isFinite)).toBe(true)
      expect(points.length).toBeGreaterThan(2)

      for (let i = 1; i < points.length; i++) {
        expect(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1]).toBe(true)
      }

      expectObstacleClearance(points, buffer, [200, 1000, 300, 1200])
    }

    // keeping both original overlapping routes would satisfy clearance but
    // silently disable nudging. The two horizontal trunks must remain spaced.
    const trunkY = normalized.map(
      points => points.find((point, i) => i > 0 && point[0] !== points[i - 1][0])![1],
    )

    expect(Math.abs(trunkY[0] - trunkY[1])).toBeGreaterThanOrEqual(6 - 1e-7)
  })

  test("nudges dense collinear fragments without enumerating discarded merge pairs", async () => {
    const result = await run("dense")
    expect(result.routed).toBe(256)
    expect(result.endpointsPreserved).toBe(true)
    expect(result.orthogonal).toBe(true)
    expect(result.finite).toBe(true)
  })

  test("processes a large orthogonal shape transaction without building unused graphs", async () => {
    const result = await run("large")
    expect(result.shapes).toBe(798)
    expectOrthogonal(result.points)
  })

  test("keeps buffered obstacle avoidance and connected endpoints", async () => {
    const { points } = await run("detour")
    expectOrthogonal(points)
    expectObstacleClearance(points, 40)
    expect(points.some(([, y]) => y <= -40 || y >= 240)).toBe(true)
  })

  test("reroutes after shapes move and are deleted", async () => {
    const { before, moved, removed } = await run("lifecycle")
    expectOrthogonal(before)
    expectOrthogonal(moved)
    expectObstacleClearance(moved, 40)

    expect(removed).toEqual([
      [0, 100],
      [500, 100],
    ])
  })

  test.each([0, 1, 2, 3])("retains late polyline routing with flags %i", async flags => {
    const { points } = await run("polyline", flags)
    expectEndpoints(points)
    expect(points.length).toBeGreaterThan(2)
    expect(points.some(([, y]) => y <= 0 || y >= 200)).toBe(true)
    expectObstacleClearance(points, 0)
  })
})
