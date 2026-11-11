import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import { afterEach, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission } from "../test-utils"
import { OperationManager } from "./manager"
import { OperationContext } from "./operation-context"
import { operationPlanTest } from "./operation-plan.fixtures"

afterEach(() => vi.restoreAllMocks())

function createManager(database: DatabaseManager, logger: Logger) {
  return new OperationManager(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { registerUnlockTask: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    database,
    logger,
  )
}

operationPlanTest(
  "rejects dependency-expanded plans before launching any operation",
  async ({ database, logger, project, testBuilder }) => {
    const { context, operation } = await testBuilder()
      .unit("allowed")
      .unit("dependency")
      .depends("allowed", "dependency")
      .states({ allowed: "undeployed", dependency: "undeployed" })
      .request("update", "allowed")
      .build()

    vi.spyOn(OperationContext, "load").mockResolvedValue(context)
    const manager = createManager(database, logger)
    const launch = vi.spyOn(manager, "launch")

    const request = {
      projectId: project.id,
      type: operation.type,
      instanceIds: operation.requestedInstanceIds,
      meta: { title: "Operation" },
    }

    const restricted = createProjectRequestContext(
      project.id,
      grantProjectPermission("operation.create", [
        { type: "instances", instanceIds: operation.requestedInstanceIds, recursive: false },
      ]),
    )

    await expect(manager.planAuthorized(restricted, request)).rejects.toThrow(PermissionDeniedError)

    await expect(manager.launchAuthorized(restricted, { ...request, plan: [] })).rejects.toThrow(
      PermissionDeniedError,
    )

    expect(launch).not.toHaveBeenCalled()
    const all = createProjectRequestContext(project.id, grantProjectPermission("operation.create"))

    expect(
      (await manager.planAuthorized(all, request)).flatMap(phase =>
        phase.instances.map(instance => instance.id),
      ),
    ).toEqual(expect.arrayContaining(["component.v1:allowed", "component.v1:dependency"]))
  },
)

operationPlanTest(
  "honors recursive grants using the authoritative model hierarchy",
  async ({ database, logger, project, testBuilder }) => {
    const { context, operation } = await testBuilder()
      .composite("parent")
      .unit("child")
      .children("parent", "child")
      .states({ parent: "undeployed", child: "undeployed" })
      .request("update", "child")
      .build()

    vi.spyOn(OperationContext, "load").mockResolvedValue(context)
    const manager = createManager(database, logger)

    const request = {
      projectId: project.id,
      type: operation.type,
      instanceIds: operation.requestedInstanceIds,
    }

    const recursive = createProjectRequestContext(
      project.id,
      grantProjectPermission("operation.create", [
        { type: "instances", instanceIds: ["composite.v1:parent"], recursive: true },
      ]),
    )

    await expect(manager.planAuthorized(recursive, request)).resolves.toBeDefined()

    const exact = createProjectRequestContext(
      project.id,
      grantProjectPermission("operation.create", [
        { type: "instances", instanceIds: ["composite.v1:parent"], recursive: false },
      ]),
    )

    await expect(manager.planAuthorized(exact, request)).rejects.toThrow(PermissionDeniedError)

    await expect(
      manager.planAuthorized(recursive, { ...request, projectId: "another-project" }),
    ).rejects.toThrow("authorization realm")
  },
)
