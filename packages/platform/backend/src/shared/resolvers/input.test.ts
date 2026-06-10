import { defineEntity, defineUnit, z } from "@highstate/contract"
import { pino } from "pino"
import { describe, expect, test } from "vitest"
import { SYSTEM_EXPORT_COMPONENT_TYPE } from "../constants"
import { getResolvedInstanceInputs, InputResolver, type InputResolverNode } from "./input"

describe("InputResolver", () => {
  test(`resolves dynamic inputs for ${SYSTEM_EXPORT_COMPONENT_TYPE} from connected outputs`, async () => {
    const entity = defineEntity({
      type: "test.entity.v1",
      schema: z.object({ value: z.string() }),
    })

    const dependency = defineUnit({
      type: "component.v1",
      outputs: {
        data: entity,
      },
      source: {
        package: "@test/units",
        path: "dependency",
      },
    })

    const exportPort = defineUnit({
      type: SYSTEM_EXPORT_COMPONENT_TYPE,
      source: {
        package: "@test/units",
        path: "export-port",
      },
    })

    const nodes = new Map<string, InputResolverNode>([
      [
        "instance:component.v1:source",
        {
          kind: "instance",
          instance: {
            id: "component.v1:source",
            kind: "unit",
            name: "source",
            type: "component.v1",
            args: {},
            inputs: {},
          },
          component: dependency.model,
          entities: {
            [entity.model.type]: entity.model,
          },
        },
      ],
      [
        `instance:${SYSTEM_EXPORT_COMPONENT_TYPE}:port`,
        {
          kind: "instance",
          instance: {
            id: `${SYSTEM_EXPORT_COMPONENT_TYPE}:port`,
            kind: "unit",
            name: "port",
            type: SYSTEM_EXPORT_COMPONENT_TYPE,
            args: {},
            inputs: {
              data: [
                {
                  instanceId: "component.v1:source",
                  output: "data",
                },
              ],
            },
          },
          component: exportPort.model,
          entities: {
            [entity.model.type]: entity.model,
          },
        },
      ],
    ])

    const resolver = new InputResolver(nodes, pino({ level: "silent" }))
    resolver.addAllNodesToWorkset()

    await resolver.process()

    const resolvedInputs = getResolvedInstanceInputs(
      resolver.outputs,
      `${SYSTEM_EXPORT_COMPONENT_TYPE}:port`,
    )

    expect(Object.keys(resolvedInputs)).toEqual(["data"])
    expect(resolvedInputs.data).toHaveLength(1)
    expect(resolvedInputs.data[0]).toMatchObject({
      input: {
        instanceId: "component.v1:source",
        output: "data",
      },
      type: "test.entity.v1",
    })
  })
})
