import { describe } from "vitest"
import { createOperationPlan } from "./operation-plan"
import { operationPlanTest } from "./operation-plan.fixtures"

describe("OperationPlan - Update Operations", () => {
  operationPlanTest(
    "1. should include out-of-date dependencies in linear chain",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "changed", C: "upToDate" })
        .request("update", "C")
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
                "message": "changed and required by "component.v1:C"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "1a. should ignore dependencies when option enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "changed", C: "upToDate" })
        .options({ ignoreDependencies: true })
        .request("update", "C")
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
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "2. should not propagate beyond compositional inclusion",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("GrandParent")
        .composite("Parent")
        .unit("A")
        .unit("B")
        .unit("C")
        .children("GrandParent", "Parent", "C")
        .children("Parent", "A")
        .depends("B", "A")
        .states({
          GrandParent: "upToDate",
          Parent: "upToDate",
          A: "changed",
          B: "upToDate",
          C: "changed",
        })
        .request("update", "B")
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
                "message": "changed and required by "component.v1:B"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:A"",
                "parentId": "composite.v1:GrandParent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "3. should force all dependencies when flag enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .options({ forceUpdateDependencies: true })
        .request("update", "C")
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
                "message": "required by "component.v1:C" (forced by options)",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "3a. should reject conflicting dependency options",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .options({ forceUpdateDependencies: true, ignoreDependencies: true })
        .request("update", "C")
        .build()

      // act & assert
      expect(() =>
        createOperationPlan(
          context,
          operation.type,
          operation.requestedInstanceIds,
          operation.options,
        ),
      ).toThrowErrorMatchingInlineSnapshot(
        "[Error: Operation options are invalid: forceUpdateDependencies and ignoreDependencies cannot both be enabled.]",
      )
    },
  )

  operationPlanTest(
    "4. should include outdated children of substantive composite",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("Child3")
        .children("Parent", "Child1", "Child2", "Child3")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "undeployed",
          Child3: "upToDate",
        })
        .request("update", "Parent")
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
                "id": "component.v1:Child1",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child2",
                "message": "undeployed and child of included parent",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "5. should cleanup ghost children during composite update",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("GhostChild")
        .children("Parent", "Child1", "GhostChild")
        .states({
          Parent: "upToDate",
          Child1: "upToDate",
          GhostChild: "ghost",
        })
        .request("update", "Parent")
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
                "id": "component.v1:GhostChild",
                "message": "ghost cleanup",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "5a. should skip ghost children in update phase when forcing child updates",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("GhostChild")
        .children("Parent", "GhostChild")
        .states({
          Parent: "upToDate",
          GhostChild: "ghost",
        })
        .options({ forceUpdateChildren: true })
        .request("update", "Parent")
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
                "id": "component.v1:GhostChild",
                "message": "ghost cleanup",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "6. should handle complex nested hierarchy correctly",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("GrandParent")
        .composite("Parent1")
        .composite("Parent2")
        .unit("Child1")
        .unit("Child2")
        .unit("Child3")
        .children("GrandParent", "Parent1", "Parent2")
        .children("Parent1", "Child1", "Child2")
        .children("Parent2", "Child3")
        .depends("Child1", "Child3")
        .states({
          GrandParent: "upToDate",
          Parent1: "upToDate",
          Parent2: "upToDate",
          Child1: "changed",
          Child2: "upToDate",
          Child3: "upToDate",
        })
        .request("update", "GrandParent")
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
                "id": "composite.v1:GrandParent",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Child1",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:Parent1",
              },
              {
                "id": "composite.v1:Parent1",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": "composite.v1:GrandParent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "7. should not include siblings when child explicitly requested (isolated update)",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("Child3")
        .children("Parent", "Child1", "Child2", "Child3")
        .states({
          Parent: "upToDate",
          Child1: "upToDate",
          Child2: "undeployed",
          Child3: "upToDate",
        })
        .request("update", "Child1")
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
                "id": "component.v1:Child1",
                "message": "explicitly requested",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "8. should force all children when flag enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("Child3")
        .children("Parent", "Child1", "Child2", "Child3")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "undeployed",
          Child3: "upToDate",
        })
        .options({ forceUpdateChildren: true })
        .request("update", "Parent")
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
                "id": "component.v1:Child1",
                "message": "child of included parent (forced by options)",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child2",
                "message": "child of included parent (forced by options)",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child3",
                "message": "child of included parent (forced by options)",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "9. should include instances with error status for recovery",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "error", C: "upToDate" })
        .request("update", "C")
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
                "message": "failed and required by "component.v1:C"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "10. should handle dependencies crossing composite boundaries",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("CompositeA")
        .composite("CompositeB")
        .unit("ChildA")
        .unit("ChildB")
        .children("CompositeA", "ChildA")
        .children("CompositeB", "ChildB")
        .depends("ChildB", "ChildA")
        .states({
          CompositeA: "upToDate",
          CompositeB: "upToDate",
          ChildA: "changed",
          ChildB: "upToDate",
        })
        .request("update", "ChildB")
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
                "id": "component.v1:ChildA",
                "message": "changed and required by "component.v1:ChildB"",
                "parentId": "composite.v1:CompositeA",
              },
              {
                "id": "component.v1:ChildB",
                "message": "explicitly requested",
                "parentId": "composite.v1:CompositeB",
              },
              {
                "id": "composite.v1:CompositeB",
                "message": "parent of included child "component.v1:ChildB"",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:CompositeA",
                "message": "parent of included child "component.v1:ChildA"",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "11. should not include unrelated instances even if they depend on updated instance",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("ExternalX")
        .children("Parent", "Child1", "Child2")
        .depends("Child1", "ExternalX")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "upToDate",
          ExternalX: "changed",
        })
        .request("update", "ExternalX")
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
                "id": "component.v1:ExternalX",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "12. should handle multiple explicit requests with overlapping dependencies",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .request("update", "A", "C")
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
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "13. should isolate boundaries in deep composite hierarchies",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("GreatGrandParent")
        .composite("GrandParent")
        .composite("Parent")
        .unit("Child")
        .unit("Uncle")
        .unit("GreatUncle")
        .children("GreatGrandParent", "GrandParent", "GreatUncle")
        .children("GrandParent", "Parent", "Uncle")
        .children("Parent", "Child")
        .states({
          GreatGrandParent: "upToDate",
          GrandParent: "upToDate",
          Parent: "upToDate",
          Child: "upToDate",
          Uncle: "upToDate",
          GreatUncle: "upToDate",
        })
        .request("update", "Child")
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
                "id": "component.v1:Child",
                "message": "explicitly requested",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child"",
                "parentId": "composite.v1:GrandParent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "14. should handle both force flags enabled together",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .depends("C", "B")
        .depends("B", "A")
        .depends("C", "Child1")
        .children("Parent", "Child1", "Child2")
        .states({
          A: "upToDate",
          B: "upToDate",
          C: "upToDate",
          Parent: "upToDate",
          Child1: "upToDate",
          Child2: "upToDate",
        })
        .options({
          forceUpdateDependencies: true,
          forceUpdateChildren: true,
        })
        .request("update", "C")
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
                "message": "required by "component.v1:C" (forced by options)",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Child1",
                "message": "required by "component.v1:C" (forced by options)",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:C",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Child2",
                "message": "child of included parent (forced by options)",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "15. should handle diamond dependency correctly",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .unit("D")
        .depends("D", "B")
        .depends("D", "C")
        .depends("B", "A")
        .depends("C", "A")
        .states({ A: "upToDate", B: "changed", C: "changed", D: "upToDate" })
        .request("update", "D")
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
                "message": "changed and required by "component.v1:D"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "changed and required by "component.v1:D"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:D",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "16. should handle composite with both ghost and real children",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("GhostChild")
        .children("Parent", "Child1", "Child2", "GhostChild")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "upToDate",
          GhostChild: "ghost",
        })
        .request("update", "Parent")
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
                "id": "component.v1:Child1",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "update",
          },
          {
            "instances": [
              {
                "id": "composite.v1:Parent",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:GhostChild",
                "message": "ghost cleanup",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "17. should include dependency chain and force siblings when partial update disabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("ExternalX")
        .children("Parent", "Child1", "Child2")
        .depends("ExternalX", "Child1")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "changed",
          ExternalX: "upToDate",
        })
        .request("update", "ExternalX")
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
                "id": "component.v1:Child1",
                "message": "changed and required by "component.v1:ExternalX"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:ExternalX",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Child2",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:Parent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "18. should include dependency chain without forcing siblings when partial update enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("ExternalX")
        .children("Parent", "Child1", "Child2")
        .depends("ExternalX", "Child1")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "changed",
          ExternalX: "upToDate",
        })
        .options({ allowPartialCompositeInstanceUpdate: true })
        .request("update", "ExternalX")
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
                "id": "component.v1:Child1",
                "message": "changed and required by "component.v1:ExternalX"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:ExternalX",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "19. should include child dependencies when child explicitly requested",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("Child3")
        .unit("Child4")
        .children("Parent", "Child1", "Child2", "Child3", "Child4")
        .depends("Child2", "Child1")
        .depends("Child3", "Child4")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          Child2: "changed",
          Child3: "changed",
          Child4: "changed",
        })
        .request("update", "Child2")
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
                "id": "component.v1:Child1",
                "message": "changed and required by "component.v1:Child2"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child2",
                "message": "explicitly requested",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child2"",
                "parentId": undefined,
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )
})
