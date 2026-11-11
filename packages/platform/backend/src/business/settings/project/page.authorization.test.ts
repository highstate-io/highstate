import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { PageSettingsService } from "./page"

describe("PageSettingsService authorization", () => {
  test("returns only granted page contents from mixed ID batches", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new PageSettingsService(database)
    const parent = await createInstanceState(project.id)
    const child = await createInstanceState(project.id)
    const other = await createInstanceState(project.id)

    await projectDatabase.instanceState.update({
      where: { id: child.id },
      data: { parentId: parent.id },
    })

    const pages = await Promise.all(
      [child, other].map(state =>
        projectDatabase.page.create({ data: { stateId: state.id, meta: {}, content: [] } }),
      ),
    )

    const context = createProjectRequestContext(
      project.id,
      grantProjectPermission("page.get", [
        { type: "instances", instanceIds: [parent.instanceId], recursive: true },
      ]),
    )

    expect(
      (
        await service.getPages(
          context,
          pages.map(page => page.id),
        )
      ).map(page => page.id),
    ).toEqual([pages[0].id])

    const resourceContext = createProjectRequestContext(
      project.id,
      grantProjectPermission("page.get", [{ type: "resources", resourceIds: [pages[1].id] }]),
    )

    expect(
      (
        await service.getPages(
          resourceContext,
          pages.map(page => page.id),
        )
      ).map(page => page.id),
    ).toEqual([pages[1].id])

    await projectDatabase.page.deleteMany({ where: { id: { in: pages.map(page => page.id) } } })
  })

  test("rejects page reads without page.get", async ({ database, project }) => {
    const service = new PageSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.query(createProjectRequestContext(project.id, grantProjectPermission("page.list")), {
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires page.get for existing page details", async ({ database, project }) => {
    const service = new PageSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()
  })
})
