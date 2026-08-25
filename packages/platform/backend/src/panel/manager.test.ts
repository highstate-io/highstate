import type { PubSubManager } from "../pubsub"
import { describe, expect, test, vi } from "vitest"
import { PanelEndpointManager } from "./manager"

describe("PanelEndpointManager", () => {
  test("publishes and resolves panel endpoints for a connected instance", () => {
    const publish = vi.fn()
    const manager = new PanelEndpointManager(vi.mockObject({ publish } as unknown as PubSubManager))
    manager.connect("project", "worker", "instance", "127.0.0.1:49152")
    manager.setPanels("project", "worker", "instance", "state", [
      { id: "panel", name: "dashboard" },
    ])

    expect(manager.getPanelEndpoint("project", "worker", "panel")).toEqual({
      authority: "127.0.0.1:49152",
      panelName: "dashboard",
      stateId: "state",
      workerInstanceId: "instance",
    })
    expect(manager.isPanelAvailable("project", "worker", "panel")).toBe(true)
    expect(publish).toHaveBeenCalledWith(["panel-availability", "project", "panel"], {
      online: true,
    })
  })

  test("pins endpoint resolution to a concrete instance", () => {
    const manager = new PanelEndpointManager()
    manager.connect("project", "worker", "instance", "worker.internal:7284")
    manager.setPanels("project", "worker", "instance", "state", [
      { id: "panel", name: "dashboard" },
    ])

    expect(manager.getPanelEndpoint("project", "worker", "panel", "instance")).toBeDefined()
    expect(manager.getPanelEndpoint("project", "worker", "panel", "other")).toBeUndefined()
  })

  test("removes endpoints when the instance disconnects", () => {
    const publish = vi.fn()
    const manager = new PanelEndpointManager(vi.mockObject({ publish } as unknown as PubSubManager))
    manager.connect("project", "worker", "instance", "127.0.0.1:49152")
    manager.setPanels("project", "worker", "instance", "state", [
      { id: "panel", name: "dashboard" },
    ])

    manager.disconnect("instance")

    expect(manager.getPanelEndpoint("project", "worker", "panel")).toBeUndefined()
    expect(publish).toHaveBeenLastCalledWith(["panel-availability", "project", "panel"], {
      online: false,
    })
  })

  test("rejects a second active instance until sharding is implemented", () => {
    const manager = new PanelEndpointManager()
    manager.connect("project", "worker", "instance-a", "127.0.0.1:49152")

    expect(() => manager.connect("project", "worker", "instance-b", "127.0.0.1:49153")).toThrow(
      "already has an active instance",
    )
  })

  test("keeps a transferred panel online when the previous instance disconnects", () => {
    const publish = vi.fn()
    const manager = new PanelEndpointManager(vi.mockObject({ publish } as unknown as PubSubManager))
    manager.connect("project", "worker-a", "instance-a", "127.0.0.1:49152")
    manager.connect("project", "worker-b", "instance-b", "127.0.0.1:49153")
    manager.setPanels("project", "worker-a", "instance-a", "state", [
      { id: "panel", name: "dashboard" },
    ])

    manager.setPanels("project", "worker-b", "instance-b", "state", [
      { id: "panel", name: "dashboard" },
    ])
    manager.disconnect("instance-a")

    expect(manager.getPanelEndpoint("project", "worker-b", "panel")).toEqual({
      authority: "127.0.0.1:49153",
      panelName: "dashboard",
      stateId: "state",
      workerInstanceId: "instance-b",
    })
    expect(publish).not.toHaveBeenCalledWith(["panel-availability", "project", "panel"], {
      online: false,
    })
  })

  test.each([
    "http://worker:7284",
    "worker",
    "worker:7284/path",
    "worker:7284?query=1",
  ])("rejects invalid data endpoint %s", endpoint => {
    const manager = new PanelEndpointManager()

    expect(() => manager.connect("project", "worker", "instance", endpoint)).toThrow(
      "Worker data endpoint",
    )
  })
})
