import { describe } from "vitest"
import { createOperationPlan } from "./operation-plan"
import { operationPlanTest } from "./operation-plan.fixtures"

describe("OperationPlan - Refresh Operations", () => {
  operationPlanTest(
    "1. should create refresh phase instead of update phase for refresh operations",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "changed" })
        .request("refresh", "B")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "2. should not include outdated dependencies in refresh phase",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "changed", B: "upToDate", C: "upToDate" })
        .request("refresh", "C")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "3. should not create destroy phase for refresh operations even with ghost children",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child")
        .children("Parent", "Child")
        .states({
          Parent: "upToDate",
          Child: "ghost",
        })
        .request("refresh", "Parent")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toHaveLength(0)
    },
  )

  operationPlanTest(
    "4. should handle composite with mixed ghost and normal children in refresh",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("GhostChild")
        .unit("NormalChild")
        .children("Parent", "GhostChild", "NormalChild")
        .states({
          Parent: "upToDate",
          GhostChild: "ghost",
          NormalChild: "changed",
        })
        .request("refresh", "Parent")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "composite.v1:Parent",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:NormalChild",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "5. should handle forceUpdateDependencies with refresh operation",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate" })
        .request("refresh", "B")
        .options({ forceUpdateDependencies: true })
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:A",
                "message": "required by "component.v1:B" (forced by options)",
                "parentId": undefined,
              },
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "6. should handle forceUpdateChildren with refresh operation",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child")
        .children("Parent", "Child")
        .states({ Parent: "upToDate", Child: "upToDate" })
        .request("refresh", "Parent")
        .options({ forceUpdateChildren: true })
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "composite.v1:Parent",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Child",
                "message": "child of included parent (forced by options)",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "7. should not include undeployed dependencies in refresh operation",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "undeployed", B: "upToDate" })
        .request("refresh", "B")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "8. should not include failed dependencies in refresh operation",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "error", B: "upToDate" })
        .request("refresh", "B")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "9. should include outdated dependencies when forced in refresh operation",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "changed", B: "upToDate" })
        .request("refresh", "B")
        .options({ forceUpdateDependencies: true })
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`
        [
          {
            "instances": [
              {
                "id": "component.v1:A",
                "message": "required by "component.v1:B" (forced by options)",
                "parentId": undefined,
              },
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "refresh",
          },
        ]
      `)
    },
  )
})
