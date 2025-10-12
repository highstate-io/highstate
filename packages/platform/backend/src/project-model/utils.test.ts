import type {
  HubModel,
  HubModelPatch,
  InstanceInput,
  InstanceModel,
  InstanceModelPatch,
} from "@highstate/contract"
import { describe, expect, test } from "vitest"
import {
  applyHubPatch,
  applyInstancePatch,
  cleanupHubReferences,
  cleanupInstanceReferences,
  deleteHubReferences,
  deleteInstanceReferences,
  renameInstanceReferences,
  updateInstanceReferences,
} from "./utils"

describe("deleteInstanceReferences", () => {
  test.concurrent("removes references to deleted instance from inputs", () => {
    const inputs: Record<string, InstanceInput[]> = {
      server: [
        { instanceId: "server.v1:target", output: "endpoint" },
        { instanceId: "server.v1:other", output: "endpoint" },
      ],
      database: [
        { instanceId: "database.v1:main", output: "connectionString" },
        { instanceId: "server.v1:target", output: "host" },
      ],
    }

    deleteInstanceReferences(inputs, "server.v1:target")

    expect(inputs).toEqual({
      server: [{ instanceId: "server.v1:other", output: "endpoint" }],
      database: [{ instanceId: "database.v1:main", output: "connectionString" }],
    })
  })

  test.concurrent("removes empty input arrays", () => {
    const inputs: Record<string, InstanceInput[]> = {
      server: [{ instanceId: "server.v1:target", output: "endpoint" }],
      database: [{ instanceId: "database.v1:main", output: "connectionString" }],
    }

    deleteInstanceReferences(inputs, "server.v1:target")

    expect(inputs).toEqual({
      database: [{ instanceId: "database.v1:main", output: "connectionString" }],
    })
    expect(inputs).not.toHaveProperty("server")
  })
})

describe("deleteHubReferences", () => {
  test.concurrent("removes references to deleted hub from hub inputs", () => {
    const inputs = {
      config: [{ hubId: "hub999" }, { hubId: "hub888" }],
      secrets: [{ hubId: "hub456" }, { hubId: "hub999" }],
    }

    deleteHubReferences(inputs, "hub999")

    expect(inputs).toEqual({
      config: [{ hubId: "hub888" }],
      secrets: [{ hubId: "hub456" }],
    })
  })

  test.concurrent("removes empty input arrays", () => {
    const inputs = {
      config: [{ hubId: "hub999" }],
      secrets: [{ hubId: "hub456" }],
    }

    deleteHubReferences(inputs, "hub999")

    expect(inputs).toEqual({
      secrets: [{ hubId: "hub456" }],
    })
    expect(inputs).not.toHaveProperty("config")
  })
})

describe("renameInstanceReferences", () => {
  test.concurrent("updates instance references to new ID", () => {
    const inputs: InstanceInput[] = [
      { instanceId: "server.v1:old", output: "endpoint" },
      { instanceId: "server.v1:other", output: "endpoint" },
      { instanceId: "server.v1:old", output: "host" },
    ]

    renameInstanceReferences(inputs, "server.v1:old", "server.v1:new")

    expect(inputs).toEqual([
      { instanceId: "server.v1:new", output: "endpoint" },
      { instanceId: "server.v1:other", output: "endpoint" },
      { instanceId: "server.v1:new", output: "host" },
    ])
  })

  test.concurrent("does not modify unrelated references", () => {
    const inputs: InstanceInput[] = [
      { instanceId: "server.v1:other", output: "endpoint" },
      { instanceId: "database.v1:main", output: "connection" },
    ]

    renameInstanceReferences(inputs, "server.v1:old", "server.v1:new")

    expect(inputs).toEqual([
      { instanceId: "server.v1:other", output: "endpoint" },
      { instanceId: "database.v1:main", output: "connection" },
    ])
  })
})

describe("cleanupInstanceReferences", () => {
  test.concurrent("removes instance references from instances and hubs", () => {
    const instances: InstanceModel[] = [
      {
        id: "server.v1:web",
        name: "web",
        type: "server.v1",
        kind: "unit",
        inputs: {
          database: [{ instanceId: "database.v1:target", output: "connection" }],
          cache: [{ instanceId: "cache.v1:redis", output: "url" }],
        },
      },
      {
        id: "server.v1:api",
        name: "api",
        type: "server.v1",
        kind: "unit",
        inputs: {
          database: [{ instanceId: "database.v1:target", output: "connection" }],
        },
      },
    ]

    const hubs: HubModel[] = [
      {
        id: "hub123",
        inputs: [{ instanceId: "database.v1:target", output: "host" }],
      },
    ]

    cleanupInstanceReferences(instances, hubs, "database.v1:target")

    expect(instances[0].inputs).toEqual({
      cache: [{ instanceId: "cache.v1:redis", output: "url" }],
    })
    expect(instances[1]).not.toHaveProperty("inputs")
    expect(hubs[0]).not.toHaveProperty("inputs")
  })

  test.concurrent("handles instances with no inputs", () => {
    const instances: InstanceModel[] = [
      {
        id: "server.v1:web",
        name: "web",
        type: "server.v1",
        kind: "unit",
      },
    ]

    const hubs: HubModel[] = []

    expect(() => cleanupInstanceReferences(instances, hubs, "database.v1:target")).not.toThrow()
  })
})

describe("cleanupHubReferences", () => {
  test.concurrent("removes hub references from instances and hubs", () => {
    const instances: InstanceModel[] = [
      {
        id: "server.v1:web",
        name: "web",
        type: "server.v1",
        kind: "unit",
        hubInputs: {
          config: [{ hubId: "hub999" }],
          secrets: [{ hubId: "hub456" }],
        },
        injectionInputs: [{ hubId: "hub999" }, { hubId: "hub789" }],
      },
    ]

    const hubs: HubModel[] = [
      {
        id: "hub123",
        injectionInputs: [{ hubId: "hub999" }, { hubId: "hub456" }],
      },
    ]

    cleanupHubReferences(instances, hubs, "hub999")

    expect(instances[0].hubInputs).toEqual({
      secrets: [{ hubId: "hub456" }],
    })
    expect(instances[0].injectionInputs).toEqual([{ hubId: "hub789" }])
    expect(hubs[0].injectionInputs).toEqual([{ hubId: "hub456" }])
  })

  test.concurrent("removes empty arrays and objects", () => {
    const instances: InstanceModel[] = [
      {
        id: "server.v1:web",
        name: "web",
        type: "server.v1",
        kind: "unit",
        hubInputs: {
          config: [{ hubId: "hub999" }],
        },
        injectionInputs: [{ hubId: "hub999" }],
      },
    ]

    const hubs: HubModel[] = []

    cleanupHubReferences(instances, hubs, "hub999")

    expect(instances[0]).not.toHaveProperty("hubInputs")
    expect(instances[0]).not.toHaveProperty("injectionInputs")
  })
})

describe("updateInstanceReferences", () => {
  test.concurrent("updates instance references across instances and hubs", () => {
    const instances: InstanceModel[] = [
      {
        id: "server.v1:web",
        name: "web",
        type: "server.v1",
        kind: "unit",
        inputs: {
          database: [{ instanceId: "database.v1:old", output: "connection" }],
        },
      },
    ]

    const hubs: HubModel[] = [
      {
        id: "hub123",
        inputs: [{ instanceId: "database.v1:old", output: "host" }],
      },
    ]

    updateInstanceReferences(instances, hubs, "database.v1:old", "database.v1:new")

    expect(instances[0].inputs?.database).toEqual([
      { instanceId: "database.v1:new", output: "connection" },
    ])
    expect(hubs[0].inputs).toEqual([{ instanceId: "database.v1:new", output: "host" }])
  })
})

describe("applyInstancePatch", () => {
  test.concurrent("applies args patch", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      args: { port: 3000 },
    }

    const patch: InstanceModelPatch = {
      args: { port: 8080, host: "0.0.0.0" },
    }

    applyInstancePatch(instance, patch)

    expect(instance.args).toEqual({ port: 8080, host: "0.0.0.0" })
  })

  test.concurrent("applies position patch", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      position: { x: 100, y: 200 },
    }

    const patch: InstanceModelPatch = {
      position: { x: 300, y: 400 },
    }

    applyInstancePatch(instance, patch)

    expect(instance.position).toEqual({ x: 300, y: 400 })
  })

  test.concurrent("applies inputs patch", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      inputs: {
        database: [{ instanceId: "database.v1:main", output: "connection" }],
      },
    }

    const patch: InstanceModelPatch = {
      inputs: {
        cache: [{ instanceId: "cache.v1:redis", output: "url" }],
      },
    }

    applyInstancePatch(instance, patch)

    expect(instance.inputs).toEqual({
      cache: [{ instanceId: "cache.v1:redis", output: "url" }],
    })
  })

  test.concurrent("removes inputs when empty object provided", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      inputs: {
        database: [{ instanceId: "database.v1:main", output: "connection" }],
      },
    }

    const patch: InstanceModelPatch = {
      inputs: {},
    }

    applyInstancePatch(instance, patch)

    expect(instance).not.toHaveProperty("inputs")
  })

  test.concurrent("applies hubInputs patch", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
    }

    const patch: InstanceModelPatch = {
      hubInputs: {
        config: [{ hubId: "hub123" }],
      },
    }

    applyInstancePatch(instance, patch)

    expect(instance.hubInputs).toEqual({
      config: [{ hubId: "hub123" }],
    })
  })

  test.concurrent("removes hubInputs when empty object provided", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      hubInputs: {
        config: [{ hubId: "hub123" }],
      },
    }

    const patch: InstanceModelPatch = {
      hubInputs: {},
    }

    applyInstancePatch(instance, patch)

    expect(instance).not.toHaveProperty("hubInputs")
  })

  test.concurrent("applies injectionInputs patch", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
    }

    const patch: InstanceModelPatch = {
      injectionInputs: [{ hubId: "hub123" }],
    }

    applyInstancePatch(instance, patch)

    expect(instance.injectionInputs).toEqual([{ hubId: "hub123" }])
  })

  test.concurrent("removes injectionInputs when empty array provided", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      injectionInputs: [{ hubId: "hub123" }],
    }

    const patch: InstanceModelPatch = {
      injectionInputs: [],
    }

    applyInstancePatch(instance, patch)

    expect(instance).not.toHaveProperty("injectionInputs")
  })

  test.concurrent("applies multiple patches at once", () => {
    const instance: InstanceModel = {
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      args: { port: 3000 },
    }

    const patch: InstanceModelPatch = {
      args: { port: 8080 },
      position: { x: 100, y: 200 },
      inputs: {
        database: [{ instanceId: "database.v1:main", output: "connection" }],
      },
    }

    applyInstancePatch(instance, patch)

    expect(instance).toEqual({
      id: "server.v1:web",
      name: "web",
      type: "server.v1",
      kind: "unit",
      args: { port: 8080 },
      position: { x: 100, y: 200 },
      inputs: {
        database: [{ instanceId: "database.v1:main", output: "connection" }],
      },
    })
  })
})

describe("applyHubPatch", () => {
  test.concurrent("applies position patch", () => {
    const hub: HubModel = {
      id: "hub123",
      position: { x: 100, y: 200 },
    }

    const patch: HubModelPatch = {
      position: { x: 300, y: 400 },
    }

    applyHubPatch(hub, patch)

    expect(hub.position).toEqual({ x: 300, y: 400 })
  })

  test.concurrent("applies inputs patch", () => {
    const hub: HubModel = {
      id: "hub123",
      inputs: [{ instanceId: "database.v1:main", output: "host" }],
    }

    const patch: HubModelPatch = {
      inputs: [{ instanceId: "server.v1:web", output: "endpoint" }],
    }

    applyHubPatch(hub, patch)

    expect(hub.inputs).toEqual([{ instanceId: "server.v1:web", output: "endpoint" }])
  })

  test.concurrent("removes inputs when empty array provided", () => {
    const hub: HubModel = {
      id: "hub123",
      inputs: [{ instanceId: "database.v1:main", output: "host" }],
    }

    const patch: HubModelPatch = {
      inputs: [],
    }

    applyHubPatch(hub, patch)

    expect(hub).not.toHaveProperty("inputs")
  })

  test.concurrent("applies injectionInputs patch", () => {
    const hub: HubModel = {
      id: "hub123",
    }

    const patch: HubModelPatch = {
      injectionInputs: [{ hubId: "hub456" }],
    }

    applyHubPatch(hub, patch)

    expect(hub.injectionInputs).toEqual([{ hubId: "hub456" }])
  })

  test.concurrent("removes injectionInputs when empty array provided", () => {
    const hub: HubModel = {
      id: "hub123",
      injectionInputs: [{ hubId: "hub456" }],
    }

    const patch: HubModelPatch = {
      injectionInputs: [],
    }

    applyHubPatch(hub, patch)

    expect(hub).not.toHaveProperty("injectionInputs")
  })

  test.concurrent("applies multiple patches at once", () => {
    const hub: HubModel = {
      id: "hub123",
    }

    const patch: HubModelPatch = {
      position: { x: 100, y: 200 },
      inputs: [{ instanceId: "server.v1:web", output: "endpoint" }],
      injectionInputs: [{ hubId: "hub456" }],
    }

    applyHubPatch(hub, patch)

    expect(hub).toEqual({
      id: "hub123",
      position: { x: 100, y: 200 },
      inputs: [{ instanceId: "server.v1:web", output: "endpoint" }],
      injectionInputs: [{ hubId: "hub456" }],
    })
  })
})
