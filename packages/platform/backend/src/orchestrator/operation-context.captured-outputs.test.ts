import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { EntitySnapshotService } from "../business"
import type { InstanceState, LibraryModel, ResolvedInstanceInput } from "../shared"
import pino from "pino"
import { describe, expect, test, vi } from "vitest"
import { OperationContext } from "./operation-context"

type TestOperationContext = {
  addInstance: (instance: InstanceModel, isGhost?: boolean) => void
  captureEntitySnapshotsAtOperationStart: (options: {
    projectId: string
    entitySnapshotService: EntitySnapshotService
  }) => Promise<void>
  getCapturedOutputValues: OperationContext["getCapturedOutputValues"]
  isGhostInstance: OperationContext["isGhostInstance"]
  resolvedInstanceInputs: Map<InstanceId, Record<string, ResolvedInstanceInput[]>>
  setState: OperationContext["setState"]
  setStates: OperationContext["setStates"]
}

function createContext(): TestOperationContext {
  return new (
    OperationContext as unknown as {
      new (...args: unknown[]): TestOperationContext
    }
  )(
    { id: "project" },
    { components: { "component.v1": {} }, entities: {} } as unknown as LibraryModel,
    pino({ level: "silent" }),
  )
}

function createInstance(id: InstanceId, inputs: InstanceModel["inputs"] = {}): InstanceModel {
  return {
    id,
    name: id.split(":")[1]!,
    type: "component.v1",
    kind: "unit",
    parentId: undefined,
    inputs,
    args: {},
    outputs: {},
  }
}

function createState(
  id: string,
  instanceId: InstanceId,
  resolvedInputs: InstanceState["resolvedInputs"] = null,
): InstanceState {
  return {
    id,
    instanceId,
    status: "deployed",
    source: "virtual",
    kind: "unit",
    hasResourceHooks: false,
    parentId: null,
    parentInstanceId: null,
    selfHash: null,
    inputHash: null,
    outputHash: null,
    dependencyOutputHash: null,
    statusFields: null,
    exportedArtifactIds: null,
    inputHashNonce: null,
    currentResourceCount: null,
    model: null,
    resolvedInputs,
  }
}

describe("OperationContext.updateCapturedOutputValuesFromUnitOutputs", () => {
  test("captures single + multiple outputs and clears missing ones", () => {
    const context = new (
      OperationContext as unknown as {
        new (...args: unknown[]): OperationContext
      }
    )(
      { id: "project" },
      {
        components: {
          "component.v1": {
            outputs: {
              single: { type: "entity.single.v1" },
              multi: { type: "entity.multi.v1", multiple: true },
            },
          },
        },
        entities: {},
      },
      pino({ level: "silent" }),
    )

    context.updateCapturedOutputValuesFromUnitOutputs({
      instanceId: "component.v1:one",
      instanceType: "component.v1",
      outputs: {
        single: { value: { a: 1 } },
        multi: { value: [{ b: 2 }, { b: 3 }] },
      },
    })

    expect(context.getCapturedOutputValues("component.v1:one", "single")).toEqual([
      { ok: true, value: { a: 1 } },
    ])
    expect(context.getCapturedOutputValues("component.v1:one", "multi")).toEqual([
      { ok: true, value: { b: 2 } },
      { ok: true, value: { b: 3 } },
    ])

    context.updateCapturedOutputValuesFromUnitOutputs({
      instanceId: "component.v1:one",
      instanceType: "component.v1",
      outputs: {
        single: { value: null },
        multi: { value: undefined },
      },
    })

    expect(context.getCapturedOutputValues("component.v1:one", "single")).toEqual([])
    expect(context.getCapturedOutputValues("component.v1:one", "multi")).toEqual([])
  })

  test("throws when multiple output is not an array", () => {
    const context = new (
      OperationContext as unknown as {
        new (...args: unknown[]): OperationContext
      }
    )(
      { id: "project" },
      {
        components: {
          "component.v1": {
            outputs: {
              multi: { type: "entity.multi.v1", multiple: true },
            },
          },
        },
        entities: {},
      },
      pino({ level: "silent" }),
    )

    expect(() =>
      context.updateCapturedOutputValuesFromUnitOutputs({
        instanceId: "component.v1:one",
        instanceType: "component.v1",
        outputs: {
          multi: { value: { b: 1 } },
        },
      }),
    ).toThrow('Output "multi" for instance "component.v1:one" must be an array')
  })

  test("throws when output item is not an object", () => {
    const context = new (
      OperationContext as unknown as {
        new (...args: unknown[]): OperationContext
      }
    )(
      { id: "project" },
      {
        components: {
          "component.v1": {
            outputs: {
              multi: { type: "entity.multi.v1", multiple: true },
            },
          },
        },
        entities: {},
      },
      pino({ level: "silent" }),
    )

    expect(() =>
      context.updateCapturedOutputValuesFromUnitOutputs({
        instanceId: "component.v1:one",
        instanceType: "component.v1",
        outputs: {
          multi: { value: [123] },
        },
      }),
    ).toThrow('Output "multi" for instance "component.v1:one" must contain objects')
  })
})

describe("OperationContext entity snapshot capture", () => {
  test("resolves a renamed ghost dependency through its stable state ID", async () => {
    const context = createContext()
    const oldDependencyId = "component.v1:relay-client-1"
    const renamedDependencyId = "component.v1:renamed-relay-client-1"
    const currentDependencyId = "component.v1:current-dependency"
    const ghostId = "component.v1:historical-ghost"
    const ghost = createInstance(ghostId, {
      dependency: [
        { instanceId: oldDependencyId, output: "value", path: "renamed" },
        { instanceId: currentDependencyId, output: "value", path: "current" },
      ],
    })

    context.addInstance(ghost, true)
    context.setStates([
      createState("renamed-dependency-state", renamedDependencyId),
      createState("current-dependency-state", currentDependencyId),
      createState("ghost-state", ghostId, {
        dependency: [
          { stateId: "current-dependency-state", output: "value", path: "current" },
          { stateId: "renamed-dependency-state", output: "value", path: "renamed" },
        ],
      }),
    ])
    context.resolvedInstanceInputs.set(ghostId, {
      dependency: [
        {
          input: { instanceId: oldDependencyId, output: "value", path: "renamed" },
          type: "test.entity.v1",
        },
        {
          input: { instanceId: currentDependencyId, output: "value", path: "current" },
          type: "test.entity.v1",
        },
      ],
    })

    const renamedValues = [{ ok: true as const, value: { name: "renamed" } }]
    const currentValues = [{ ok: true as const, value: { name: "current" } }]
    const reconstructLatestExportedOutputValues = vi.fn().mockResolvedValue(
      new Map([
        ["renamed-dependency-state:value", renamedValues],
        ["current-dependency-state:value", currentValues],
      ]),
    )
    const entitySnapshotService = {
      reconstructLatestExportedOutputValues,
    } as unknown as EntitySnapshotService

    await context.captureEntitySnapshotsAtOperationStart({
      projectId: "project",
      entitySnapshotService,
    })

    expect(context.isGhostInstance(ghostId)).toBe(true)
    expect(reconstructLatestExportedOutputValues).toHaveBeenCalledWith(
      "project",
      [
        { stateId: "renamed-dependency-state", output: "value", operationId: undefined },
        { stateId: "current-dependency-state", output: "value", operationId: undefined },
      ],
      expect.anything(),
    )
    expect(context.getCapturedOutputValues(oldDependencyId, "value")).toEqual(renamedValues)
    expect(context.getCapturedOutputValues(renamedDependencyId, "value")).toEqual([])
    expect(context.getCapturedOutputValues(currentDependencyId, "value")).toEqual(currentValues)
  })

  test("fails when a dependency has neither an instance state nor a stable state reference", async () => {
    const context = createContext()
    const missingDependencyId = "component.v1:missing"
    const ghostId = "component.v1:historical-ghost"

    context.setState(createState("ghost-state", ghostId, {}))
    context.resolvedInstanceInputs.set(ghostId, {
      dependency: [
        {
          input: { instanceId: missingDependencyId, output: "value" },
          type: "test.entity.v1",
        },
      ],
    })

    await expect(
      context.captureEntitySnapshotsAtOperationStart({
        projectId: "project",
        entitySnapshotService: {} as EntitySnapshotService,
      }),
    ).rejects.toThrow(
      `Instance state for "${missingDependencyId}" not found in the operation context`,
    )
  })
})
