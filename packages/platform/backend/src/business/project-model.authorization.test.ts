import type { InstanceModel } from "@highstate/contract"
import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { ProjectModelService } from "./project-model"

describe("ProjectModelService authorization", () => {
  test("filters model snapshots using parent scopes without exposing unrelated hubs or instances", async ({
    database,
    project,
  }) => {
    const service = new ProjectModelService(
      database,
      {} as never,
      {} as never,
      {},
      { registerUnlockTask: vi.fn() } as never,
      {} as never,
    )

    const instance = (name: string, parentId?: InstanceModel["id"]): InstanceModel => ({
      id: `component.v1:${name}`,
      type: "component.v1",
      name,
      kind: "unit",
      parentId,
      args: {},
      inputs: {},
      outputs: {},
      resolvedInputs: {},
      resolvedOutputs: {},
    })

    const parent = instance("parent")
    const child = instance("child", parent.id)
    const unrelated = instance("unrelated")

    const model = {
      instances: [parent, child, unrelated],
      virtualInstances: [],
      ghostInstances: [],
      hubs: [{ id: "private-hub" }],
    } as never

    const context = createProjectRequestContext(
      project.id,
      grantProjectPermission("instance-model.get", [
        { type: "instances", instanceIds: [parent.id], recursive: true },
      ]),
    )

    expect(service.filterAuthorizedModel(context, model)).toMatchObject({
      instances: [parent, child],
      hubs: [],
    })

    const exact = createProjectRequestContext(
      project.id,
      grantProjectPermission("instance-model.get", [
        { type: "instances", instanceIds: [parent.id], recursive: false },
      ]),
    )

    expect(service.filterAuthorizedModel(exact, model).instances).toEqual([parent])
  })

  test("requires instance-model.get", async ({ database, project }) => {
    const service = new ProjectModelService(
      database,
      {} as never,
      {} as never,
      {},
      { registerUnlockTask: vi.fn() } as never,
      {} as never,
    )

    vi.spyOn(service, "getProjectModelCore").mockResolvedValue([
      { instances: [], hubs: [], virtualInstances: [], ghostInstances: [] },
      project,
    ] as never)

    await expect(service.getProjectModel(createProjectRequestContext(project.id))).rejects.toThrow(
      PermissionDeniedError,
    )

    await expect(
      service.getProjectModel(
        createProjectRequestContext(project.id, grantProjectPermission("instance-model.get")),
      ),
    ).resolves.toBeDefined()
  })
})
