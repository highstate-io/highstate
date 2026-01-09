import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { defineComponent } from "./component"
import { defineEntity } from "./entity"
import { resetEvaluation } from "./evaluation"

describe("defineComponent", () => {
  beforeEach(resetEvaluation)

  it("should return a component with no args", () => {
    const virtualMachine = defineComponent({
      type: "proxmox.virtual-machine.v1",
      create: () => ({}),
    })

    virtualMachine({
      name: "test1",
    })

    virtualMachine({
      name: "test2",
      args: {},
    })
  })

  it("should return a component with args", () => {
    const virtualMachine = defineComponent({
      type: "proxmox.virtual_machine.v1",
      args: {
        cores: z.number(),
      },
      create: () => ({}),
    })

    virtualMachine({
      name: "test",
      args: {
        cores: 2,
      },
    })
  })

  it("should return a component with inputs", () => {
    const resource = defineEntity({
      type: "common.resource.v1",

      schema: z.object({
        id: z.string(),
      }),
    })

    const server = defineEntity({
      type: "common.server.v1",

      includes: { resource },

      schema: z.object({
        endpoint: z.string(),
      }),

      meta: {
        title: "Server",
        description: "A server entity",
        color: "#ff0000",
      },
    })

    expect(server.model.implementations).toEqual([
      {
        type: "common.resource.v1",
        required: true,
        multiple: false,
      },
    ])

    const embeddedResult = server.schema.safeParse({
      endpoint: "127.0.0.1",
      "common.resource.v1": {
        id: "test",
      },
    })

    expect(embeddedResult.success).toBe(true)

    const cluster = defineComponent({
      type: "talos.cluster.v1",
      inputs: {
        servers: {
          entity: server,
          multiple: true,
        },
      },
      create: () => ({}),
    })

    cluster({
      name: "test",
      inputs: {
        servers: [
          {
            instanceId: "test.v1:test",
            output: "test",
          },
        ],
      },
    })
  })

  it("should return a component with outputs", () => {
    const server = defineEntity({
      type: "common.server.v1",

      schema: z.object({
        endpoint: z.string(),
      }),

      meta: {
        title: "Server",
        description: "A server entity",
        color: "#ff0000",
      },
    })

    const cluster = defineComponent({
      type: "talos.cluster.v1",
      outputs: {
        servers: {
          entity: server,
          multiple: true,
          required: false,
        },
      },
      create: () => ({
        servers: [],
      }),
    })

    cluster({
      name: "test",
    })
  })

  it("should support entities with intersection schemas", () => {
    const resource = defineEntity({
      type: "common.resource.v1",

      schema: z.object({
        id: z.string(),
      }),
    })

    const tagged = z.object({
      tag: z.string(),
    })

    const server = defineEntity({
      type: "common.server.v1",

      includes: {
        resource: { entity: resource, required: false, multiple: true },
      },

      schema: z.intersection(
        tagged,
        z.object({
          endpoint: z.string(),
        }),
      ),
    })

    expect(server.model.implementations).toEqual([
      {
        type: "common.resource.v1",
        required: false,
        multiple: true,
      },
    ])

    expect(
      server.schema.safeParse({
        tag: "prod",
        endpoint: "127.0.0.1",
        "common.resource.v1": [{ id: "test" }],
      }).success,
    ).toBe(true)
  })

  it("should return a component with args, inputs and outputs", () => {
    const server = defineEntity({
      type: "common.server.v1",

      schema: z.object({
        endpoint: z.string(),
      }),

      meta: {
        title: "Server",
        description: "A server entity",
        color: "#ff0000",
      },
    })

    const cluster = defineComponent({
      type: "talos.cluster.v1",
      args: {
        name: z.string(),
      },
      inputs: {
        servers: {
          entity: server,
          multiple: true,
          required: false,
        },
      },
      outputs: {
        servers: {
          entity: server,
          multiple: true,
        },
      },
      create: ({ inputs }) => ({ servers: inputs.servers ?? [] }),
    })

    const { servers } = cluster({
      name: "test",
      args: {
        name: "test",
      },
      inputs: {
        servers: [
          {
            instanceId: "test.v1:test",
            output: "test",
          },
        ],
      },
    })

    void servers
  })
})
