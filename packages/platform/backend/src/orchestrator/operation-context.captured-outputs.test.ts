import pino from "pino"
import { describe, expect, test } from "vitest"
import { OperationContext } from "./operation-context"

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

    expect(context.getCapturedOutputValues("component.v1:one", "single")).toEqual([{ a: 1 }])
    expect(context.getCapturedOutputValues("component.v1:one", "multi")).toEqual([
      { b: 2 },
      { b: 3 },
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
