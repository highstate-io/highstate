import { describe } from "vitest"
import { createOperationPlan } from "./operation-plan"
import { operationPlanTest } from "./operation-plan.fixtures"

describe("OperationPlan - Preview Operations", () => {
  operationPlanTest(
    "1. returns single preview phase for requested unit",
    async ({ testBuilder, expect }) => {
      const { context, operation } = await testBuilder()
        .unit("App")
        .request("preview", "App")
        .build()

      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:App",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "preview",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "2. throws when multiple instances are requested",
    async ({ testBuilder, expect }) => {
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .request("preview", "A", "B")
        .build()

      expect(() =>
        createOperationPlan(
          context,
          operation.type,
          operation.requestedInstanceIds,
          operation.options,
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        "[Error: Preview operations can only target a single instance]",
      )
    },
  )

  operationPlanTest(
    "3. throws when previewing composite instance",
    async ({ testBuilder, expect }) => {
      const { context, operation } = await testBuilder()
        .composite("Group")
        .request("preview", "Group")
        .build()

      expect(() =>
        createOperationPlan(
          context,
          operation.type,
          operation.requestedInstanceIds,
          operation.options,
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        '[Error: Preview is not supported for composite instance "composite.v1:Group"]',
      )
    },
  )
})
