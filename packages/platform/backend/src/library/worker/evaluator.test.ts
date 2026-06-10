import type { ResolvedInstanceInput } from "../../shared"
import {
  type Component,
  defineComponent,
  defineEntity,
  defineUnit,
  getInstanceId,
  type InstanceModel,
  resetEvaluation,
  z,
} from "@highstate/contract"
import { pino } from "pino"
import { beforeEach, describe, expect, test } from "vitest"
import { evaluateProject } from "./evaluator"

describe("evaluateProject", () => {
  beforeEach(() => {
    resetEvaluation()
  })

  const createCompositeInstance = (
    type: InstanceModel["type"],
    name: InstanceModel["name"],
  ): InstanceModel => ({
    id: getInstanceId(type, name),
    kind: "composite",
    type,
    name,
    args: {},
    inputs: {},
    hubInputs: {},
    injectionInputs: [],
  })

  const createUnitInstance = (
    type: InstanceModel["type"],
    name: InstanceModel["name"],
  ): InstanceModel => ({
    id: getInstanceId(type, name),
    kind: "unit",
    type,
    name,
    args: {},
    inputs: {},
    hubInputs: {},
    injectionInputs: [],
  })

  test("materializes virtual child dependencies produced by another composite", () => {
    const entity = defineEntity({
      type: "test.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const childUnit = defineUnit({
      type: "child.v1",
      outputs: {
        out: entity,
      },
      source: {
        package: "@test/unit",
        path: "child",
      },
    })

    const producer = defineComponent({
      type: "producer.v1",
      create: () => {
        childUnit({ name: "child" })
      },
    })

    const consumer = defineComponent({
      type: "consumer.v1",
      inputs: {
        dep: entity,
      },
      create: () => {},
    })

    const producerInstanceId = getInstanceId("producer.v1", "producer")
    const consumerInstanceId = getInstanceId("consumer.v1", "consumer")
    const childInstanceId = getInstanceId("child.v1", "child")

    const allInstances: InstanceModel[] = [
      {
        id: consumerInstanceId,
        kind: "composite",
        type: "consumer.v1",
        name: "consumer",
        args: {},
        inputs: {},
        hubInputs: {},
        injectionInputs: [],
      },
      {
        id: producerInstanceId,
        kind: "composite",
        type: "producer.v1",
        name: "producer",
        args: {},
        inputs: {},
        hubInputs: {},
        injectionInputs: [],
      },
    ]

    const resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>> = {
      [consumerInstanceId]: {
        dep: [
          {
            input: { instanceId: childInstanceId, output: "out" },
            type: entity.model.type,
          },
        ],
      },
    }

    const result = evaluateProject(
      pino({ level: "silent" }),
      {
        "producer.v1": producer,
        "consumer.v1": consumer,
        "child.v1": childUnit,
      } as unknown as Readonly<Record<string, Component>>,
      allInstances,
      resolvedInputs,
    )

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.topLevelErrors[consumerInstanceId]).toBeUndefined()
    expect(result.virtualInstances.some(instance => instance.id === childInstanceId)).toBe(true)
  })

  test("captures top-level errors when dependency instance is missing", () => {
    const entity = defineEntity({
      type: "missing.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const consumer = defineComponent({
      type: "missing-consumer.v1",
      inputs: {
        dep: entity,
      },
      create: () => {},
    })

    const consumerInstance = createCompositeInstance("missing-consumer.v1", "consumer")

    const result = evaluateProject(
      pino({ level: "silent" }),
      {
        "missing-consumer.v1": consumer,
      } as unknown as Readonly<Record<string, Component>>,
      [consumerInstance],
      {
        [consumerInstance.id]: {
          dep: [
            {
              input: {
                instanceId: getInstanceId("missing-child.v1", "ghost"),
                output: "out",
              },
              type: entity.model.type,
            },
          ],
        },
      },
    )

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.topLevelErrors[consumerInstance.id]).toContain("Instance not found")
  })

  test("fails entire evaluation on instance name conflicts", () => {
    const childUnit = defineUnit({
      type: "conflict-child.v1",
      source: {
        package: "@test/unit",
        path: "conflict-child",
      },
    })

    const leftProducer = defineComponent({
      type: "left-producer.v1",
      create: () => {
        childUnit({ name: "duplicate" })
      },
    })

    const rightProducer = defineComponent({
      type: "right-producer.v1",
      create: () => {
        childUnit({ name: "duplicate" })
      },
    })

    const result = evaluateProject(
      pino({ level: "silent" }),
      {
        "left-producer.v1": leftProducer,
        "right-producer.v1": rightProducer,
        "conflict-child.v1": childUnit,
      } as unknown as Readonly<Record<string, Component>>,
      [
        createCompositeInstance("left-producer.v1", "left"),
        createCompositeInstance("right-producer.v1", "right"),
      ],
      {},
    )

    expect(result.success).toBe(false)
    if (result.success) {
      return
    }

    expect(result.error).toContain("Multiple instances produced with the same instance ID")
  })

  test("includes composites and virtual children but excludes top-level units", () => {
    const childUnit = defineUnit({
      type: "virtual-child.v1",
      source: {
        package: "@test/unit",
        path: "virtual-child",
      },
    })

    const topLevelUnit = defineUnit({
      type: "top-level-unit.v1",
      source: {
        package: "@test/unit",
        path: "top-level-unit",
      },
    })

    const producer = defineComponent({
      type: "virtual-producer.v1",
      create: () => {
        childUnit({ name: "spawned" })
      },
    })

    const producerInstance = createCompositeInstance("virtual-producer.v1", "producer")
    const topLevelUnitInstance = createUnitInstance("top-level-unit.v1", "source")
    const childInstanceId = getInstanceId("virtual-child.v1", "spawned")

    const result = evaluateProject(
      pino({ level: "silent" }),
      {
        "virtual-producer.v1": producer,
        "virtual-child.v1": childUnit,
        "top-level-unit.v1": topLevelUnit,
      } as unknown as Readonly<Record<string, Component>>,
      [producerInstance, topLevelUnitInstance],
      {},
    )

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    const virtualIds = result.virtualInstances.map(instance => instance.id)

    expect(virtualIds).toContain(producerInstance.id)
    expect(virtualIds).toContain(childInstanceId)
    expect(virtualIds).not.toContain(topLevelUnitInstance.id)
  })

  test("resolves dependency outputs from top-level units", () => {
    const entity = defineEntity({
      type: "dependency.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const sourceUnit = defineUnit({
      type: "dependency-source.v1",
      outputs: {
        out: entity,
      },
      source: {
        package: "@test/unit",
        path: "dependency-source",
      },
    })

    const consumer = defineComponent({
      type: "dependency-consumer.v1",
      inputs: {
        dep: entity,
      },
      create: ({ inputs }) => ({
        pass: inputs.dep,
      }),
      outputs: {
        pass: entity,
      },
    })

    const sourceInstance = createUnitInstance("dependency-source.v1", "source")
    const consumerInstance = createCompositeInstance("dependency-consumer.v1", "consumer")

    const result = evaluateProject(
      pino({ level: "silent" }),
      {
        "dependency-source.v1": sourceUnit,
        "dependency-consumer.v1": consumer,
      } as unknown as Readonly<Record<string, Component>>,
      [sourceInstance, consumerInstance],
      {
        [consumerInstance.id]: {
          dep: [
            {
              input: {
                instanceId: sourceInstance.id,
                output: "out",
              },
              type: entity.model.type,
            },
          ],
        },
      },
    )

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.topLevelErrors[consumerInstance.id]).toBeUndefined()
  })
})
