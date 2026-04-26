import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { defineComponent } from "./component"
import { defineEntity } from "./entity"
import { getRuntimeInstances, resetEvaluation } from "./evaluation"
import { type EntityInput, type InstanceInput, selectInput } from "./instance"
import { boundaryInput, kind } from "./shared"

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
      type: "proxmox.virtual-machine.v1",
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

      includes: {
        resource,
      },

      schema: z.object({
        endpoint: z.string(),
      }),

      meta: {
        title: "Server",
        description: "A server entity",
        color: "#ff0000",
      },
    })

    expect(server.model.directInclusions).toEqual([
      {
        field: "resource",
        type: "common.resource.v1",
        required: true,
        multiple: false,
      },
    ])

    const embeddedResult = server.schema.safeParse({
      $meta: {
        type: "common.server.v1",
        identity: "server-1",
      },
      endpoint: "127.0.0.1",
      resource: {
        $meta: {
          type: "common.resource.v1",
          identity: "resource-1",
        },
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

    expect(server.model.directInclusions).toEqual([
      {
        field: "resource",
        type: "common.resource.v1",
        required: false,
        multiple: true,
      },
    ])

    expect(
      server.schema.safeParse({
        $meta: {
          type: "common.server.v1",
          identity: "server-1",
        },
        tag: "prod",
        endpoint: "127.0.0.1",
        "common.resource.v1": [
          {
            $meta: {
              type: "common.resource.v1",
              identity: "resource-1",
            },
            id: "test",
          },
        ],
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

  it("should create deep output accessors with dynamic paths", () => {
    const subnet = defineEntity({
      type: "network.subnet.v1",
      schema: z.object({ cidr: z.string() }),
    })

    const endpoint = defineEntity({
      type: "network.l4-endpoint.v1",
      includes: {
        subnet,
      },
      schema: z.object({ host: z.string() }),
    })

    const peer = defineEntity({
      type: "wireguard.peer.v1",
      includes: {
        endpoints: {
          entity: endpoint,
          multiple: true,
          required: false,
        },
      },
      schema: z.object({ name: z.string() }),
    })

    const producer = defineComponent({
      type: "test.producer.v1",
      outputs: {
        peer,
      },
      create: ({ id }) => ({
        peer: {
          instanceId: id,
          output: "peer",
        } as never,
      }),
    })

    const { peer: peerInput } = producer({ name: "test" })

    expect(Array.isArray(peerInput.endpoints)).toBe(false)
    expect(peerInput.endpoints.path).toBe("endpoints")
    expect(peerInput.endpoints.subnet.path).toBe("endpoints.subnet")
  })

  it("should preserve parent boundary for selected provided input", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    const source = defineComponent({
      type: "example.source.v1",
      outputs: { k8sCluster: cluster },
      create: ({ id }) => ({
        k8sCluster: { instanceId: id, output: "k8sCluster" },
      }),
    })

    const child = defineComponent({
      type: "example.child.v1",
      inputs: { k8sCluster: cluster },
      create: () => ({}),
    })

    const parent = defineComponent({
      type: "example.parent.v1",
      inputs: {
        k8sClusters: {
          entity: cluster,
          multiple: true,
          required: false,
        },
      },
      create: ({ name, inputs }) => {
        child({
          name: `${name}.selected-child`,
          inputs: {
            k8sCluster: selectInput(inputs.k8sClusters, "cluster-1"),
          },
        })

        return {}
      },
    })

    const { k8sCluster } = source({ name: "cluster-1" })

    parent({
      name: "parent-1",
      inputs: { k8sClusters: [k8sCluster] },
    })

    const childInstance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.child.v1:parent-1.selected-child",
    )?.instance

    expect(childInstance).toBeDefined()
    expect(childInstance?.inputs?.k8sCluster).toEqual([
      {
        instanceId: "example.parent.v1:parent-1",
        output: "k8sClusters",
      },
    ])
  })

  it("should preserve nested dynamic accessors for selected provided input", () => {
    const subnet = defineEntity({
      type: "network.subnet.v1",
      schema: z.object({ cidr: z.string() }),
    })

    const endpoint = defineEntity({
      type: "network.l4-endpoint.v1",
      includes: {
        subnet,
      },
      schema: z.object({ host: z.string() }),
    })

    const peer = defineEntity({
      type: "wireguard.peer.v1",
      includes: {
        endpoints: {
          entity: endpoint,
          multiple: true,
          required: false,
        },
      },
      schema: z.object({ name: z.string() }),
    })

    let selectedSubnetPath: string | undefined

    const producer = defineComponent({
      type: "example.peer-source.v1",
      outputs: {
        peer,
      },
      create: ({ id }) => ({
        peer: {
          instanceId: id,
          output: "peer",
        } as never,
      }),
    })

    const selector = defineComponent({
      type: "example.peer-selector.v1",
      inputs: {
        peers: {
          entity: peer,
          multiple: true,
        },
      },
      create: ({ inputs }) => {
        const selectedPeer = selectInput(inputs.peers, "peer-1")
        selectedSubnetPath = selectedPeer.endpoints.subnet.path

        return {}
      },
    })

    const { peer: peerInput } = producer({ name: "peer-1" })

    selector({
      name: "selector-1",
      inputs: {
        peers: [peerInput],
      },
    })

    expect(selectedSubnetPath).toBe("endpoints.subnet")
  })

  it("should not mutate original boundary when selecting provided input", () => {
    const peer = defineEntity({
      type: "wireguard.peer.v1",
      schema: z.object({ name: z.string() }),
    })

    const source = defineComponent({
      type: "example.peer-source.v1",
      outputs: { peer },
      create: ({ id }) => ({
        peer: { instanceId: id, output: "peer" },
      }),
    })

    const { peer: peerInput } = source({ name: "peer-1" })
    const originalBoundary = peerInput[boundaryInput]

    const selectedGroup = [peerInput] as (typeof peerInput)[] & { [boundaryInput]: InstanceInput }
    selectedGroup[boundaryInput] = {
      instanceId: "example.parent.v1:parent-1",
      output: "peers",
    }

    const selected = selectInput(selectedGroup, "peer-1")

    expect(peerInput[boundaryInput]).toEqual(originalBoundary)
    expect(selected[boundaryInput]).toEqual({
      instanceId: "example.parent.v1:parent-1",
      output: "peers",
    })
  })

  it("should return chained missing proxy when selected input is absent", () => {
    const peer = defineEntity({
      type: "wireguard.peer.v1",
      schema: z.object({ name: z.string() }),
    })

    const source = defineComponent({
      type: "example.peer-source.v1",
      outputs: { peer },
      create: ({ id }) => ({
        peer: { instanceId: id, output: "peer" },
      }),
    })

    const { peer: peerInput } = source({ name: "peer-1" })

    const selectedGroup = [peerInput] as (typeof peerInput)[] & { [boundaryInput]: InstanceInput }
    selectedGroup[boundaryInput] = {
      instanceId: "example.parent.v1:parent-1",
      output: "peers",
    }

    const missingPeer = selectInput(selectedGroup, "missing-peer")

    expect(missingPeer.provided).toBe(false)
    expect(missingPeer[boundaryInput]).toEqual({
      instanceId: "example.parent.v1:parent-1",
      output: "peers",
    })

    const nestedMissing = (missingPeer as Record<string, unknown>).network as Record<
      string,
      unknown
    >
    expect((nestedMissing.provided as boolean) ?? false).toBe(false)
  })

  it("should preserve parent boundary for indexed multiple input item", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    const source = defineComponent({
      type: "example.source.v1",
      outputs: { k8sCluster: cluster },
      create: ({ id }) => ({
        k8sCluster: { instanceId: id, output: "k8sCluster" },
      }),
    })

    const child = defineComponent({
      type: "example.child.v1",
      inputs: { k8sCluster: cluster },
      create: () => ({}),
    })

    const parent = defineComponent({
      type: "example.parent.v1",
      inputs: {
        k8sClusters: {
          entity: cluster,
          multiple: true,
          required: false,
        },
      },
      create: ({ name, inputs }) => {
        child({
          name: `${name}.indexed-child`,
          inputs: {
            k8sCluster: inputs.k8sClusters[0],
          },
        })

        return {}
      },
    })

    const { k8sCluster } = source({ name: "cluster-1" })

    parent({
      name: "parent-2",
      inputs: { k8sClusters: [k8sCluster] },
    })

    const childInstance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.child.v1:parent-2.indexed-child",
    )?.instance

    expect(childInstance).toBeDefined()
    expect(childInstance?.inputs?.k8sCluster).toEqual([
      {
        instanceId: "example.parent.v1:parent-2",
        output: "k8sClusters",
      },
    ])
  })

  it("should preserve nested composite output boundary when passing to another component", () => {
    const peer = defineEntity({
      type: "example.peer.v1",
      schema: z.object({ name: z.string() }),
    })

    const producer = defineComponent({
      type: "example.peer-source.v1",
      outputs: { peer },
      create: ({ id }) => ({
        peer: {
          instanceId: id,
          output: "peer",
        },
      }),
    })

    const location = defineComponent({
      type: "example.location.v1",
      outputs: { peer },
      create: ({ name }) => {
        const { peer: producedPeer } = producer({ name })

        return {
          peer: producedPeer,
        }
      },
    })

    const consumer = defineComponent({
      type: "example.peer-consumer.v1",
      inputs: {
        peers: {
          entity: peer,
          multiple: true,
        },
      },
      create: () => ({}),
    })

    const locationSet = defineComponent({
      type: "example.location-set.v1",
      create: () => {
        const { peer: locationPeer } = location({ name: "amsterdam" })

        consumer({
          name: "identity",
          inputs: {
            peers: [locationPeer],
          },
        })

        return {}
      },
    })

    locationSet({ name: "test" })

    const consumerInstance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.peer-consumer.v1:identity",
    )?.instance

    expect(consumerInstance?.inputs?.peers).toEqual([
      {
        instanceId: "example.location.v1:amsterdam",
        output: "peer",
      },
    ])
  })

  it("should preserve boundaries from empty nested input groups", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    const component = defineComponent({
      type: "example.boundary-preserving.v1",
      inputs: {
        k8sClusters: {
          entity: cluster,
          multiple: true,
          required: false,
        },
      },
      create: () => ({}),
    })

    const emptyGroup = [] as unknown as InstanceInput[] & { [boundaryInput]: InstanceInput }

    emptyGroup[boundaryInput] = {
      instanceId: "example.source.v1:source",
      output: "k8sClusters",
    }

    component({
      name: "test",
      inputs: {
        k8sClusters: [emptyGroup],
      },
    })

    const instance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.boundary-preserving.v1:test",
    )?.instance

    expect(instance?.inputs?.k8sClusters).toEqual([
      {
        instanceId: "example.source.v1:source",
        output: "k8sClusters",
      },
    ])
  })

  it("should throw when selecting from empty input array without boundary", () => {
    expect(() => selectInput([], "missing")).toThrow(
      'Cannot select input "missing": empty input group has no boundary metadata to build a missing input reference.',
    )
  })

  it("should not leak optional metadata into resolved outputs", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    const passthrough = defineComponent({
      type: "example.passthrough.v1",
      inputs: {
        k8sCluster: {
          entity: cluster,
          required: false,
        },
      },
      outputs: {
        k8sCluster: {
          entity: cluster,
          required: false,
        },
      },
      create: ({ inputs }) => ({
        k8sCluster: inputs.k8sCluster,
      }),
    })

    passthrough({ name: "test" })

    const instance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.passthrough.v1:test",
    )?.instance

    expect(instance).toBeDefined()
    expect(instance?.resolvedOutputs?.k8sCluster).toEqual([])
    expect(instance?.outputs?.k8sCluster).toEqual([
      {
        instanceId: "example.passthrough.v1:test",
        output: "k8sCluster",
      },
    ])
  })

  it("should keep output path as plain string metadata", () => {
    const peer = defineEntity({
      type: "example.peer.v1",
      schema: z.object({ id: z.string() }),
    })

    const source = defineComponent({
      type: "example.path-source.v1",
      outputs: { peer },
      create: ({ id }) => ({
        peer: {
          instanceId: id,
          output: "peer",
        },
      }),
    })

    const passthrough = defineComponent({
      type: "example.path-passthrough.v1",
      inputs: {
        peer: {
          entity: peer,
          required: false,
        },
      },
      outputs: {
        peer: {
          entity: peer,
          required: false,
        },
      },
      create: ({ inputs }) => ({
        peer: inputs.peer.provided
          ? {
              instanceId: inputs.peer.instanceId,
              output: inputs.peer.output,
              path: "id",
            }
          : undefined,
      }),
    })

    const { peer: sourcePeer } = source({ name: "source" })

    passthrough({
      name: "test",
      inputs: {
        peer: sourcePeer,
      },
    })

    const instance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.path-passthrough.v1:test",
    )?.instance

    expect(instance?.resolvedOutputs?.peer).toEqual([
      {
        instanceId: "example.path-source.v1:source",
        output: "peer",
        path: "id",
      },
    ])
  })

  it("should track missing input in model and pass provided-false placeholder with parent boundary", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    let createInputs: Record<string, unknown> | undefined

    const component = defineComponent({
      type: "example.missing-input-tracking.v1",
      inputs: {
        k8sCluster: {
          entity: cluster,
          required: false,
        },
      },
      create: ({ inputs }) => {
        createInputs = inputs as Record<string, unknown>
        return {}
      },
    })

    component({
      name: "test",
      inputs: {
        k8sCluster: {
          provided: false,
          [boundaryInput]: {
            instanceId: "example.source.v1:source",
            output: "k8sCluster",
          },
        } as never,
      },
    })

    const instance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.missing-input-tracking.v1:test",
    )?.instance

    expect(instance?.inputs?.k8sCluster).toEqual([
      {
        instanceId: "example.source.v1:source",
        output: "k8sCluster",
      },
    ])
    expect(createInputs).toEqual({
      k8sCluster: {
        provided: false,
        [boundaryInput]: {
          instanceId: "example.missing-input-tracking.v1:test",
          output: "k8sCluster",
        },
      },
    })
  })

  it("should pass missing multiple input with parent boundary", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ host: z.string() }),
    })

    let receivedBoundary: InstanceInput | undefined

    const component = defineComponent({
      type: "example.missing-multiple-boundary.v1",
      inputs: {
        endpoints: {
          entity: endpoint,
          multiple: true,
          required: false,
        },
      },
      create: ({ inputs }) => {
        receivedBoundary = (inputs.endpoints as unknown as { [boundaryInput]: InstanceInput })[
          boundaryInput
        ]
        return {}
      },
    })

    const upstreamGroup = [] as unknown as EntityInput<typeof endpoint>[] & {
      [boundaryInput]: InstanceInput
    }
    upstreamGroup[boundaryInput] = {
      instanceId: "example.upstream.v1:source",
      output: "endpoints",
    }

    component({
      name: "test",
      inputs: {
        endpoints: upstreamGroup,
      },
    })

    const instance = getRuntimeInstances().find(
      runtime => runtime.instance.id === "example.missing-multiple-boundary.v1:test",
    )?.instance

    expect(instance?.inputs?.endpoints).toEqual([
      {
        instanceId: "example.upstream.v1:source",
        output: "endpoints",
      },
    ])

    expect(receivedBoundary).toEqual({
      instanceId: "example.missing-multiple-boundary.v1:test",
      output: "endpoints",
    })
  })

  it("should pass only provided items for multiple input", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    const source = defineComponent({
      type: "example.source.v1",
      outputs: { k8sCluster: cluster },
      create: ({ id }) => ({
        k8sCluster: { instanceId: id, output: "k8sCluster" },
      }),
    })

    let receivedCount = -1

    const component = defineComponent({
      type: "example.multiple-filtering.v1",
      inputs: {
        k8sClusters: {
          entity: cluster,
          multiple: true,
          required: false,
        },
      },
      create: ({ inputs }) => {
        receivedCount = inputs.k8sClusters?.length ?? 0
        return {}
      },
    })

    const { k8sCluster } = source({ name: "cluster-1" })

    component({
      name: "test",
      inputs: {
        k8sClusters: [
          k8sCluster,
          {
            provided: false,
            [boundaryInput]: {
              instanceId: "example.source.v1:missing",
              output: "k8sCluster",
            },
          } as never,
        ],
      },
    })

    expect(receivedCount).toBe(1)
  })

  it("should keep empty multiple input iterable", () => {
    const cluster = defineEntity({
      type: "example.cluster.v1",
      schema: z.object({ id: z.string() }),
    })

    let receivedCount = -1

    const component = defineComponent({
      type: "example.empty-multiple.v1",
      inputs: {
        k8sClusters: {
          entity: cluster,
          multiple: true,
          required: false,
        },
      },
      create: ({ inputs }) => {
        receivedCount = [...(inputs.k8sClusters ?? [])].length
        return {}
      },
    })

    component({
      name: "test",
      inputs: {
        k8sClusters: [
          {
            provided: false,
            [boundaryInput]: {
              instanceId: "example.source.v1:missing",
              output: "k8sCluster",
            },
          } as never,
        ],
      },
    })

    expect(receivedCount).toBe(0)
  })

  it("should keep declared multiple output defined when omitted", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ id: z.string() }),
    })

    const component = defineComponent({
      type: "example.missing-multiple-output.v1",
      outputs: {
        endpoints: {
          entity: endpoint,
          multiple: true,
        },
      },
      create: () => ({}),
    })

    const outputs = component({ name: "test" }) as Record<string, unknown>
    const endpoints = outputs.endpoints as Array<Record<string, unknown>> & {
      [boundaryInput]?: InstanceInput
      address: {
        asSubnet: Array<Record<string, unknown>>
      }
    }

    expect(Array.isArray(endpoints)).toBe(true)
    expect(endpoints.length).toBe(0)
    expect(endpoints.address.asSubnet.length).toBe(0)
    expect(endpoints[boundaryInput]).toEqual({
      instanceId: "example.missing-multiple-output.v1:test",
      output: "endpoints",
    })
  })

  it("should keep declared single output defined when omitted", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ id: z.string() }),
    })

    const component = defineComponent({
      type: "example.missing-single-output.v1",
      outputs: {
        endpoint,
      },
      create: () => ({}),
    })

    const outputs = component({ name: "test" }) as Record<string, unknown>
    const output = outputs.endpoint as Record<string | symbol, unknown>

    expect(output).toBeDefined()
    expect(output.provided).toBe(false)
    expect(output[boundaryInput]).toEqual({
      instanceId: "example.missing-single-output.v1:test",
      output: "endpoint",
    })
  })

  it("should allow non-provided single output in composite component", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ id: z.string() }),
    })

    const component = defineComponent({
      type: "example.non-provided-single-output.v1",
      outputs: {
        endpoint,
      },
      create: ({ id }) => ({
        endpoint: {
          provided: false as never,
          [boundaryInput]: {
            instanceId: id,
            output: "endpoint",
          },
        },
      }),
    })

    const outputs = component({ name: "test" }) as Record<string, unknown>
    const output = outputs.endpoint as Record<string | symbol, unknown>

    expect(output.provided).toBe(false)
    expect(output[boundaryInput]).toEqual({
      instanceId: "example.non-provided-single-output.v1:test",
      output: "endpoint",
    })
  })

  it("should reject non-provided items in multiple outputs", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ id: z.string() }),
    })

    const component = defineComponent({
      type: "example.invalid-multiple-output.v1",
      outputs: {
        endpoints: {
          entity: endpoint,
          multiple: true,
        },
      },
      create: ({ id }) => ({
        endpoints: [
          {
            provided: false,
            [boundaryInput]: {
              instanceId: id,
              output: "endpoints",
            },
          } as never,
        ],
      }),
    })

    expect(() => component({ name: "test" })).toThrow(
      'Multiple output "endpoints" in instance "example.invalid-multiple-output.v1:test" cannot contain non-provided items',
    )
  })

  it("should require provided outputs for unit components", () => {
    const endpoint = defineEntity({
      type: "example.endpoint.v1",
      schema: z.object({ id: z.string() }),
    })

    const unitLike = defineComponent({
      type: "example.invalid-unit-output.v1",
      [kind]: "unit",
      outputs: {
        endpoint,
      },
      create: ({ id }) => ({
        endpoint: {
          provided: false,
          [boundaryInput]: {
            instanceId: id,
            output: "endpoint",
          },
        },
      }),
    })

    expect(() => unitLike({ name: "test" })).toThrow(
      'Unit output "endpoint" in instance "example.invalid-unit-output.v1:test" must be provided',
    )
  })
})
