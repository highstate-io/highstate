import { create } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import {
  LaunchOperationRequestSchema,
  OperationType,
  PlanOperationRequestSchema,
} from "@highstate/api/v1"
import { describe, expect, it, vi } from "vitest"
import { createOperationService } from "./operation"

const context = { requestHeader: new Headers({ authorization: "Bearer project-key" }) }
function fixture(allowed = true) {
  const planReviewed = vi.fn(async () => ({
    token: "signed-plan",
    phases: [],
    librarySnapshotId: "snapshot",
    modelRevision: "model-revision",
    localOverlayRevision: null,
  }))
  const launch = vi.fn(async () => {
    throw new Error("Reviewed plan is stale or does not match the launch request")
  })
  const services = {
    database: {
      backend: { project: { findUnique: async () => ({ id: "project" }) } },
      forProject: async () => ({
        serviceAccountRoleBinding: {
          findMany: async () =>
            allowed
              ? [{ role: { rules: [{ permissions: ["operation.create", "operation.cancel"] }] } }]
              : [],
        },
      }),
    },
    apiKeyService: {
      getProjectCredentialByToken: async () => ({
        id: "key",
        serviceAccountId: "account",
        restrictionRules: [],
      }),
    },
    projectUnlockService: { checkProjectUnlocked: async () => true },
    operationManager: { planReviewed, launch },
  }
  return { handler: createOperationService(services as never), planReviewed, launch }
}

describe("reviewed operation transport", () => {
  it("requires operation creation permission before issuing or consuming a plan", async () => {
    const { handler, planReviewed, launch } = fixture(false)
    await expect(
      handler.planOperation(
        create(PlanOperationRequestSchema, { projectId: "project" }),
        context as never,
      ),
    ).rejects.toThrow()
    await expect(
      handler.launchOperation(
        create(LaunchOperationRequestSchema, { projectId: "project", planToken: "signed-plan" }),
        context as never,
      ),
    ).rejects.toThrow()
    expect(planReviewed).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
  it("returns the token together with the exact revisions reviewed", async () => {
    const { handler, planReviewed } = fixture()
    const result = await handler.planOperation(
      create(PlanOperationRequestSchema, {
        projectId: "project",
        type: OperationType.UPDATE,
        instanceIds: ["example.unit.v1:main"],
      }),
      context as never,
    )
    expect(planReviewed).toHaveBeenCalledOnce()
    expect(result.plan).toMatchObject({
      token: "signed-plan",
      librarySnapshotId: "snapshot",
      modelRevision: "model-revision",
      phases: [],
    })
  })

  it("rejects caller phases without a backend token before launching", async () => {
    const { handler, launch } = fixture()
    await expect(
      handler.launchOperation(
        create(LaunchOperationRequestSchema, {
          projectId: "project",
          type: OperationType.UPDATE,
          plan: [{ instances: [] }],
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition })
    expect(launch).not.toHaveBeenCalled()
  })

  it("forwards only the reviewed token and makes a stale plan actionable", async () => {
    const { handler, launch } = fixture()
    await expect(
      handler.launchOperation(
        create(LaunchOperationRequestSchema, {
          projectId: "project",
          type: OperationType.UPDATE,
          instanceIds: ["example.unit.v1:main"],
          meta: { title: "Update" },
          planToken: "signed-plan",
          plan: [{ instances: [] }],
        }),
        context as never,
      ),
    ).rejects.toMatchObject({ code: Code.FailedPrecondition })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ planToken: "signed-plan", plan: undefined }),
    )
  })
})
