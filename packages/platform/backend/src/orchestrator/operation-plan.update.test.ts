import type { InstanceState } from "../shared"
import { getInstanceId } from "@highstate/contract"
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
    "1a. should skip only changed dependencies when ignoreChangedDependencies enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "changed", C: "upToDate" })
        .options({ ignoreChangedDependencies: true })
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
    "1b. should still include undeployed dependencies when ignoreChangedDependencies enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "changed", B: "undeployed", C: "upToDate" })
        .options({ ignoreChangedDependencies: true })
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
                "message": "undeployed and required by "component.v1:C"",
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
    "1c. should ignore all dependencies when ignoreDependencies enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .unit("C")
        .depends("C", "B")
        .depends("B", "A")
        .states({ A: "changed", B: "undeployed", C: "upToDate" })
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
    "1d. should tolerate missing parent instance in model when walking substantive ancestors",
    async ({ createContext, createTestOperation, expect }) => {
      // arrange
      const missingParentId = getInstanceId("composite.v1", "MissingParent")
      const parentId = getInstanceId("composite.v1", "Parent")
      const childId = getInstanceId("component.v1", "Child")
      const requestedId = getInstanceId("component.v1", "Requested")

      const context = await createContext(
        [
          {
            id: parentId,
            name: "Parent",
            type: "composite.v1",
            kind: "composite",
            parentId: missingParentId,
            inputs: {},
            args: {},
            outputs: {},
            resolvedInputs: {},
            resolvedOutputs: {},
          },
          {
            id: childId,
            name: "Child",
            type: "component.v1",
            kind: "unit",
            parentId,
            inputs: {},
            args: {},
            outputs: {},
            resolvedInputs: {},
            resolvedOutputs: {},
          },
          {
            id: requestedId,
            name: "Requested",
            type: "component.v1",
            kind: "unit",
            parentId: undefined,
            inputs: {
              dependency: [{ instanceId: childId, output: "default" }],
            },
            args: {},
            outputs: {},
            resolvedInputs: {
              dependency: [{ instanceId: childId, output: "default" }],
            },
            resolvedOutputs: {},
          },
        ],
        [
          {
            id: parentId,
            instanceId: parentId,
            status: "deployed",
            source: "resident",
            kind: "composite",
            hasResourceHooks: false,
            parentId: null,
            parentInstanceId: missingParentId,
            selfHash: null,
            inputHash: null,
            outputHash: null,
            dependencyOutputHash: null,
            statusFields: null,
            exportedArtifactIds: null,
            inputHashNonce: null,
            currentResourceCount: null,
            model: null,
            resolvedInputs: null,
            lastOperationState: undefined,
            evaluationState: null,
          },
          {
            id: childId,
            instanceId: childId,
            status: "undeployed",
            source: "resident",
            kind: "unit",
            hasResourceHooks: false,
            parentId: null,
            parentInstanceId: parentId,
            selfHash: null,
            inputHash: null,
            outputHash: null,
            dependencyOutputHash: null,
            statusFields: null,
            exportedArtifactIds: null,
            inputHashNonce: null,
            currentResourceCount: null,
            model: null,
            resolvedInputs: null,
            lastOperationState: undefined,
            evaluationState: {} as InstanceState["evaluationState"],
          },
          {
            id: requestedId,
            instanceId: requestedId,
            status: "deployed",
            source: "resident",
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
            resolvedInputs: null,
            lastOperationState: undefined,
            evaluationState: {} as InstanceState["evaluationState"],
          },
        ],
      )

      const operation = createTestOperation("update", [requestedId])

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
                "message": "undeployed and required by "component.v1:Requested"",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:Requested",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "composite.v1:Parent",
                "message": "parent of included child "component.v1:Child"",
                "parentId": "composite.v1:MissingParent",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "2. should include full ancestor chain for compositional inclusion",
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
              {
                "id": "composite.v1:GrandParent",
                "message": "parent of included child "composite.v1:Parent"",
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
        .options({ forceUpdateDependencies: true, ignoreChangedDependencies: true })
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
        "[Error: Operation options are invalid: forceUpdateDependencies and ignoreChangedDependencies cannot both be enabled.]",
      )
    },
  )

  operationPlanTest(
    "3b. should reject conflicting force dependency and ignore options",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate" })
        .options({ forceUpdateDependencies: true, ignoreDependencies: true })
        .request("update", "B")
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
    "3c. should reject conflicting ignore changed and ignore options",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .unit("A")
        .unit("B")
        .depends("B", "A")
        .states({ A: "upToDate", B: "upToDate" })
        .options({ ignoreChangedDependencies: true, ignoreDependencies: true })
        .request("update", "B")
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
        "[Error: Operation options are invalid: ignoreChangedDependencies and ignoreDependencies cannot both be enabled.]",
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
    "5a. should cleanup ghost children when forceUpdateChildren is enabled",
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
    "5b. should cleanup ghosts from nested child composites during parent composite update",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .composite("ChildComposite")
        .unit("GhostLeaf")
        .children("Parent", "ChildComposite")
        .children("ChildComposite", "GhostLeaf")
        .states({
          Parent: "upToDate",
          ChildComposite: "upToDate",
          GhostLeaf: "ghost",
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
                "id": "composite.v1:ChildComposite",
                "message": "included in operation",
                "parentId": "composite.v1:Parent",
              },
              {
                "id": "component.v1:GhostLeaf",
                "message": "ghost cleanup",
                "parentId": "composite.v1:ChildComposite",
              },
            ],
            "type": "destroy",
          },
        ]
      `)
    },
  )

  operationPlanTest(
    "5c. should run only ghost destroy phase when onlyDestroyGhosts is enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("GhostChild")
        .children("Parent", "Child1", "GhostChild")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          GhostChild: "ghost",
        })
        .options({ onlyDestroyGhosts: true })
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
    "5d. should place ghost destroy phase before update when firstDestroyGhosts is enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("GhostChild")
        .children("Parent", "Child1", "GhostChild")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          GhostChild: "ghost",
        })
        .options({ firstDestroyGhosts: true })
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
        ]
      `)
    },
  )

  operationPlanTest(
    "5e. should skip ghost destroy phase when ignoreGhosts is enabled",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("Child1")
        .unit("GhostChild")
        .children("Parent", "Child1", "GhostChild")
        .states({
          Parent: "upToDate",
          Child1: "changed",
          GhostChild: "ghost",
        })
        .options({ ignoreGhosts: true })
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
        ]
      `)
    },
  )

  operationPlanTest(
    "5f. should reject mutually exclusive ghost options",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Parent")
        .unit("GhostChild")
        .children("Parent", "GhostChild")
        .states({ Parent: "upToDate", GhostChild: "ghost" })
        .options({ onlyDestroyGhosts: true, ignoreGhosts: true })
        .request("update", "Parent")
        .build()

      // act & assert
      expect(() =>
        createOperationPlan(
          context,
          operation.type,
          operation.requestedInstanceIds,
          operation.options,
        ),
      ).toThrow(
        "Operation options are invalid: only one of onlyDestroyGhosts, firstDestroyGhosts, ignoreGhosts can be enabled.",
      )
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
    "13. should include deep ancestor chain without ancestor siblings",
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
              {
                "id": "composite.v1:GrandParent",
                "message": "parent of included child "composite.v1:Parent"",
                "parentId": "composite.v1:GreatGrandParent",
              },
              {
                "id": "composite.v1:GreatGrandParent",
                "message": "parent of included child "composite.v1:GrandParent"",
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

  operationPlanTest(
    "20. should skip explicitly requested empty nested composites",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Root")
        .composite("Level1")
        .composite("Level2")
        .children("Root", "Level1")
        .children("Level1", "Level2")
        .states({
          Root: "upToDate",
          Level1: "upToDate",
          Level2: "upToDate",
        })
        .request("update", "Root")
        .build()

      // act
      const plan = createOperationPlan(
        context,
        operation.type,
        operation.requestedInstanceIds,
        operation.options,
      )

      // assert
      expect(plan).toMatchInlineSnapshot(`[]`)
    },
  )

  operationPlanTest(
    "21. should keep non-empty branch while skipping empty nested composites",
    async ({ testBuilder, expect }) => {
      // arrange
      const { context, operation } = await testBuilder()
        .composite("Root")
        .composite("EmptyLevel1")
        .composite("EmptyLevel2")
        .composite("NonEmptyLevel1")
        .unit("Leaf")
        .children("Root", "EmptyLevel1", "NonEmptyLevel1")
        .children("EmptyLevel1", "EmptyLevel2")
        .children("NonEmptyLevel1", "Leaf")
        .states({
          Root: "upToDate",
          EmptyLevel1: "upToDate",
          EmptyLevel2: "upToDate",
          NonEmptyLevel1: "upToDate",
          Leaf: "changed",
        })
        .request("update", "Root")
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
                "id": "composite.v1:Root",
                "message": "explicitly requested",
                "parentId": undefined,
              },
              {
                "id": "component.v1:Leaf",
                "message": "changed and child of included parent",
                "parentId": "composite.v1:NonEmptyLevel1",
              },
              {
                "id": "composite.v1:NonEmptyLevel1",
                "message": "parent of included child "component.v1:Leaf"",
                "parentId": "composite.v1:Root",
              },
            ],
            "type": "update",
          },
        ]
      `)
    },
  )
})
