import { describe } from "vitest"
import { createOperationPlan } from "./operation-plan"
import { operationPlanTest } from "./operation-plan.fixtures"

describe("OperationPlan - Destroy Operations", () => {
  operationPlanTest(
    "1. should include all dependents in linear chain when destroyDependentInstances enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .request("destroy", "A")
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
                "message": "dependent of destroyed "component.v1:B"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:B",
                "message": "dependent of destroyed "component.v1:A"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:A",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "2. should not include dependents in linear chain when destroyDependentInstances disabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .options({ destroyDependentInstances: false })
        .request("destroy", "A")
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
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "3. should include all dependents when middle node requested with destroyDependentInstances enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .request("destroy", "B")
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
                "message": "dependent of destroyed "component.v1:B"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:B",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "4. should not propagate beyond compositional inclusion",
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
          A: "upToDate",
          B: "upToDate",
          C: "upToDate",
        })
        .request("destroy", "A")
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
                "message": "dependent of destroyed "component.v1:A"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:A",
                "message": "explicitly requested",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:A"",
                "parentId": "composite.v1:GrandParent",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "5. should include all children of substantive composite",
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
          Child2: "upToDate",
          Child3: "upToDate",
        })
        .request("destroy", "Parent")
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
                "message": "child of included parent",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child2",
                "message": "child of included parent",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Child3",
                "message": "child of included parent",
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
    "6. should handle complex nested hierarchy with dependencies",
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
          Child1: "upToDate",
          Child2: "upToDate",
          Child3: "upToDate",
        })
        .request("destroy", "Child1")
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
                "parentId": "composite.v1:Parent1",
              },
              {
                "id": "composite.v1:Parent1",
                "message": "parent of included child "component.v1:Child1"",
                "parentId": "composite.v1:GrandParent",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "7. should not include siblings when child explicitly requested",
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
          Child2: "upToDate",
          Child3: "upToDate",
        })
        .request("destroy", "Child1")
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
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "8. should handle dependencies crossing composite boundaries",
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
          ChildA: "upToDate",
          ChildB: "upToDate",
        })
        .request("destroy", "ChildA")
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
                "id": "component.v1:ChildB",
                "message": "dependent of destroyed "component.v1:ChildA"",
                "parentId": "composite.v1:CompositeB",
              },
              {
                "id": "component.v1:ChildA",
                "message": "explicitly requested",
                "parentId": "composite.v1:CompositeA",
              },
              {
                "id": "composite.v1:CompositeA",
                "message": "parent of included child "component.v1:ChildA"",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:CompositeB",
                "message": "parent of included child "component.v1:ChildB"",
                "parentId": undefined,
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "9. should not include unrelated instances that don't depend on destroyed instance",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("Child2")
        .unit("UnrelatedX")
        .unit("ExternalY")
        .children("Parent", "Child1", "Child2")
        .depends("Child1", "ExternalY")
        .depends("Child2", "UnrelatedX")
        .states({
          Parent: "upToDate",
          Child1: "upToDate",
          Child2: "upToDate",
          UnrelatedX: "upToDate",
          ExternalY: "upToDate",
        })
        .request("destroy", "ExternalY")
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
                "message": "dependent of destroyed "component.v1:ExternalY"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:ExternalY",
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
                "message": "child of included parent",
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
    "10. should handle multiple explicit requests with overlapping dependencies",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate", C: "upToDate" })
        .request("destroy", "A", "C")
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
              {
                "id": "component.v1:B",
                "message": "dependent of destroyed "component.v1:A"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:A",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "11. should isolate boundaries in deep composite hierarchies",
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
        .request("destroy", "Child")
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
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "12. should handle diamond dependency correctly",
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
        .states({ A: "upToDate", B: "upToDate", C: "upToDate", D: "upToDate" })
        .request("destroy", "A")
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
                "id": "component.v1:D",
                "message": "dependent of destroyed "component.v1:B"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:B",
                "message": "dependent of destroyed "component.v1:A"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:C",
                "message": "dependent of destroyed "component.v1:A"",
                "parentId": undefined,
              },
              {
                "id": "component.v1:A",
                "message": "explicitly requested",
                "parentId": undefined,
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "13. should include dependency chain and force siblings when partial destruction disabled",
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
          Child1: "upToDate",
          Child2: "upToDate",
          ExternalX: "upToDate",
        })
        .request("destroy", "ExternalX")
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
                "message": "dependent of destroyed "component.v1:ExternalX"",
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
                "message": "child of included parent",
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
    "14. should include dependency chain without forcing siblings when partial destruction enabled",
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
          Child1: "upToDate",
          Child2: "upToDate",
          ExternalX: "upToDate",
        })
        .options({ allowPartialCompositeInstanceDestruction: true })
        .request("destroy", "ExternalX")
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
                "message": "dependent of destroyed "component.v1:ExternalX"",
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
            "type": "destroy",
          },
        ]
      `)
    },
  )
})
