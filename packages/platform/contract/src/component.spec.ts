import { beforeEach, describe, it } from "vitest"
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
