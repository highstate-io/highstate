import { describe, expect, it } from "vitest"
import { resolveChartValues } from "./helm"

describe("resolveChartValues", () => {
  it("deep merges caller values over helper values", () => {
    expect(
      resolveChartValues(
        {
          image: { repository: "example/app", tag: "latest" },
          replicas: 1,
        },
        {
          image: { tag: "stable" },
        },
        [],
      ),
    ).toEqual({
      image: { repository: "example/app", tag: "stable" },
      replicas: 1,
    })
  })

  it("applies JSON Patch operations after values in order", () => {
    expect(
      resolveChartValues(
        {
          deployment: { replicas: 1 },
          images: ["first"],
        },
        {
          deployment: { replicas: 2 },
        },
        [
          { op: "replace", path: "/deployment/replicas", value: 3 },
          { op: "add", path: "/images/-", value: "second" },
          { op: "copy", from: "/deployment/replicas", path: "/workers" },
          { op: "move", from: "/workers", path: "/replicas" },
          { op: "test", path: "/replicas", value: 3 },
          { op: "remove", path: "/deployment" },
        ],
      ),
    ).toEqual({
      images: ["first", "second"],
      replicas: 3,
    })
  })

  it("supports escaped JSON Pointer segments", () => {
    expect(
      resolveChartValues({ annotations: { "example.com/key": "old" } }, {}, [
        { op: "replace", path: "/annotations/example.com~1key", value: "new" },
      ]),
    ).toEqual({ annotations: { "example.com/key": "new" } })
  })

  it("reports the index of a failed operation", () => {
    expect(() =>
      resolveChartValues({}, {}, [
        { op: "add", path: "/enabled", value: true },
        { op: "replace", path: "/missing", value: true },
      ]),
    ).toThrow("Failed to apply Helm values patch at index 1")
  })
})
