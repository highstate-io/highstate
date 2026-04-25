import type {
  ComponentModel,
  EntityModel,
  HubInput,
  InstanceInput,
  InstanceModel,
} from "@highstate/contract"
import { describe, expect, test } from "vitest"
import { type InstanceTypeContext, resolveEffectiveOutputType } from "./effective-output-type"

function createEntity(
  type: EntityModel["type"],
  inclusions?: EntityModel["inclusions"],
): EntityModel {
  return {
    type,
    inclusions,
    schema: {},
    meta: {
      title: type,
    },
    definitionHash: 1,
  }
}

function createInputSpec(
  type: EntityModel["type"],
  options?: { fromInput?: string; multiple?: boolean },
) {
  return {
    type,
    fromInput: options?.fromInput,
    required: true,
    multiple: options?.multiple ?? false,
    meta: {
      title: type,
    },
  }
}

function createComponent(options: {
  type: ComponentModel["type"]
  inputs?: Record<string, ReturnType<typeof createInputSpec>>
  outputs?: Record<string, ReturnType<typeof createInputSpec>>
}): ComponentModel {
  return {
    type: options.type,
    kind: "unit",
    args: {},
    inputs: options.inputs ?? {},
    outputs: options.outputs ?? {},
    meta: {
      title: options.type,
      defaultNamePrefix: "test",
    },
    definitionHash: 1,
  }
}

function createInstance(options: {
  id: InstanceModel["id"]
  type: InstanceModel["type"]
  inputs?: Record<string, InstanceInput[]>
  hubInputs?: Record<string, HubInput[]>
  injectionInputs?: HubInput[]
}): InstanceModel {
  return {
    id: options.id,
    name: "instance",
    type: options.type,
    kind: "unit",
    inputs: options.inputs,
    hubInputs: options.hubInputs,
    injectionInputs: options.injectionInputs,
  }
}

function createResolver(contexts: Record<string, InstanceTypeContext>) {
  return (instanceId: string) => contexts[instanceId]
}

describe("resolveEffectiveOutputType", () => {
  test.concurrent("returns declared output type when no fromInput is used", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1"),
    }

    const instance = createInstance({
      id: "example.writer.v1:writer-1",
      type: "example.writer.v1",
    })

    const component = createComponent({
      type: "example.writer.v1",
      outputs: {
        value: createInputSpec("example.base.v1"),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: { instanceId: instance.id, output: "value" },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [instance.id]: {
          instance,
          component,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.base.v1")
  })

  test.concurrent("forwards output type from a single direct input", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1"),
      "example.child.v1": createEntity("example.child.v1"),
    }

    const source = createInstance({
      id: "example.source.v1:source-1",
      type: "example.source.v1",
    })

    const sourceComponent = createComponent({
      type: "example.source.v1",
      outputs: {
        value: createInputSpec("example.child.v1"),
      },
    })

    const forwarder = createInstance({
      id: "example.forwarder.v1:forwarder-1",
      type: "example.forwarder.v1",
      inputs: {
        source: [{ instanceId: source.id, output: "value" }],
      },
    })

    const forwarderComponent = createComponent({
      type: "example.forwarder.v1",
      inputs: {
        source: createInputSpec("example.base.v1"),
      },
      outputs: {
        value: createInputSpec("example.base.v1", { fromInput: "source" }),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: { instanceId: forwarder.id, output: "value" },
      fallbackType: "example.base.v1",
      getInstanceContext: createResolver({
        [source.id]: {
          instance: source,
          component: sourceComponent,
          entities,
        },
        [forwarder.id]: {
          instance: forwarder,
          component: forwarderComponent,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.child.v1")
  })

  test.concurrent("falls back when forwarded source input has hub inputs", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1"),
      "example.child.v1": createEntity("example.child.v1"),
    }

    const source = createInstance({
      id: "example.source.v1:source-1",
      type: "example.source.v1",
    })

    const sourceComponent = createComponent({
      type: "example.source.v1",
      outputs: {
        value: createInputSpec("example.child.v1"),
      },
    })

    const forwarder = createInstance({
      id: "example.forwarder.v1:forwarder-1",
      type: "example.forwarder.v1",
      inputs: {
        source: [{ instanceId: source.id, output: "value" }],
      },
      hubInputs: {
        source: [{ hubId: "hub1" }],
      },
    })

    const forwarderComponent = createComponent({
      type: "example.forwarder.v1",
      inputs: {
        source: createInputSpec("example.base.v1"),
      },
      outputs: {
        value: createInputSpec("example.base.v1", { fromInput: "source" }),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: { instanceId: forwarder.id, output: "value" },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [source.id]: {
          instance: source,
          component: sourceComponent,
          entities,
        },
        [forwarder.id]: {
          instance: forwarder,
          component: forwarderComponent,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.base.v1")
  })

  test.concurrent("falls back when forwarded source input has multiple direct inputs", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1"),
      "example.child.v1": createEntity("example.child.v1"),
    }

    const source = createInstance({
      id: "example.source.v1:source-1",
      type: "example.source.v1",
    })

    const sourceComponent = createComponent({
      type: "example.source.v1",
      outputs: {
        value: createInputSpec("example.child.v1"),
      },
    })

    const forwarder = createInstance({
      id: "example.forwarder.v1:forwarder-1",
      type: "example.forwarder.v1",
      inputs: {
        source: [
          { instanceId: source.id, output: "value" },
          { instanceId: source.id, output: "value" },
        ],
      },
    })

    const forwarderComponent = createComponent({
      type: "example.forwarder.v1",
      inputs: {
        source: createInputSpec("example.base.v1"),
      },
      outputs: {
        value: createInputSpec("example.base.v1", { fromInput: "source" }),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: { instanceId: forwarder.id, output: "value" },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [source.id]: {
          instance: source,
          component: sourceComponent,
          entities,
        },
        [forwarder.id]: {
          instance: forwarder,
          component: forwarderComponent,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.base.v1")
  })

  test.concurrent("applies path traversal to the resolved type", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1", [
        {
          type: "example.child.v1",
          field: "child",
          required: true,
          multiple: false,
        },
      ]),
      "example.child.v1": createEntity("example.child.v1", [
        {
          type: "example.leaf.v1",
          field: "leaf",
          required: true,
          multiple: false,
        },
      ]),
      "example.leaf.v1": createEntity("example.leaf.v1"),
    }

    const instance = createInstance({
      id: "example.writer.v1:writer-1",
      type: "example.writer.v1",
    })

    const component = createComponent({
      type: "example.writer.v1",
      outputs: {
        value: createInputSpec("example.base.v1"),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: {
        instanceId: instance.id,
        output: "value",
        path: "child.leaf",
      },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [instance.id]: {
          instance,
          component,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.leaf.v1")
  })

  test.concurrent("returns root type when path is invalid", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1", [
        {
          type: "example.child.v1",
          field: "child",
          required: true,
          multiple: false,
        },
      ]),
      "example.child.v1": createEntity("example.child.v1"),
    }

    const instance = createInstance({
      id: "example.writer.v1:writer-1",
      type: "example.writer.v1",
    })

    const component = createComponent({
      type: "example.writer.v1",
      outputs: {
        value: createInputSpec("example.base.v1"),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: {
        instanceId: instance.id,
        output: "value",
        path: "missing.segment",
      },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [instance.id]: {
          instance,
          component,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.base.v1")
  })

  test.concurrent(
    "uses direct inclusion when no path is provided and fallback matches inclusion type",
    () => {
      const entities = {
        "example.identity.v1": createEntity("example.identity.v1", [
          {
            type: "example.peer.v1",
            field: "peer",
            required: true,
            multiple: false,
          },
        ]),
        "example.peer.v1": createEntity("example.peer.v1"),
      }

      const identity = createInstance({
        id: "example.identity.v1:identity-1",
        type: "example.identity.v1",
      })

      const component = createComponent({
        type: "example.identity.v1",
        outputs: {
          identity: createInputSpec("example.identity.v1"),
        },
      })

      const resolved = resolveEffectiveOutputType({
        input: {
          instanceId: identity.id,
          output: "identity",
        },
        fallbackType: "example.peer.v1",
        getInstanceContext: createResolver({
          [identity.id]: {
            instance: identity,
            component,
            entities,
          },
        }),
      })

      expect(resolved).toBe("example.peer.v1")
    },
  )

  test.concurrent("handles forwarding cycles without recursion errors", () => {
    const entities = {
      "example.base.v1": createEntity("example.base.v1"),
    }

    const instanceA = createInstance({
      id: "example.a.v1:a-1",
      type: "example.a.v1",
      inputs: {
        source: [{ instanceId: "example.b.v1:b-1", output: "value" }],
      },
    })

    const instanceB = createInstance({
      id: "example.b.v1:b-1",
      type: "example.b.v1",
      inputs: {
        source: [{ instanceId: "example.a.v1:a-1", output: "value" }],
      },
    })

    const componentA = createComponent({
      type: "example.a.v1",
      inputs: {
        source: createInputSpec("example.base.v1"),
      },
      outputs: {
        value: createInputSpec("example.base.v1", { fromInput: "source" }),
      },
    })

    const componentB = createComponent({
      type: "example.b.v1",
      inputs: {
        source: createInputSpec("example.base.v1"),
      },
      outputs: {
        value: createInputSpec("example.base.v1", { fromInput: "source" }),
      },
    })

    const resolved = resolveEffectiveOutputType({
      input: {
        instanceId: instanceA.id,
        output: "value",
      },
      fallbackType: "example.fallback.v1",
      getInstanceContext: createResolver({
        [instanceA.id]: {
          instance: instanceA,
          component: componentA,
          entities,
        },
        [instanceB.id]: {
          instance: instanceB,
          component: componentB,
          entities,
        },
      }),
    })

    expect(resolved).toBe("example.base.v1")
  })
})
