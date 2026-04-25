import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { test } from "../test-utils/services"
import { ObjectRefIndexService } from "./object-ref-index"

describe(ObjectRefIndexService.name, () => {
  test("track inserts unique ids and ignores blanks", async ({ database, project, logger }) => {
    const service = new ObjectRefIndexService(database, logger)

    const id1 = createId()
    const id2 = createId()

    await service.track(project.id, [id1, `  ${id1}  `, "", "   ", id2])
    await service.track(project.id, [id1, id2])

    const refs = await database.backend.object.findMany({
      where: { projectId: project.id },
      select: { id: true },
    })

    expect(refs.map(r => r.id).sort()).toEqual([id1, id2].sort())
  })

  test("syncProject indexes curated object ids", async ({
    database,
    projectDatabase,
    project,
    logger,
  }) => {
    const service = new ObjectRefIndexService(database, logger)

    const operation = await projectDatabase.operation.create({
      data: {
        meta: { title: "op" },
        type: "update",
        options: {},
        requestedInstanceIds: [],
      },
      select: { id: true },
    })

    const state = await projectDatabase.instanceState.create({
      data: {
        instanceId: `component.v1:${createId()}`,
        kind: "unit",
        status: "undeployed",
        source: "resident",
      },
      select: { id: true },
    })

    const artifact = await projectDatabase.artifact.create({
      data: {
        meta: { title: "artifact" },
        hash: `sha256:${createId()}`,
        size: 1,
        chunkSize: 1,
      },
      select: { id: true },
    })

    const page = await projectDatabase.page.create({
      data: {
        meta: { title: "page" },
        content: [],
      },
      select: { id: true },
    })

    const secret = await projectDatabase.secret.create({
      data: {
        meta: { title: "secret" },
        content: { value: "x" },
      },
      select: { id: true },
    })

    const serviceAccount = await projectDatabase.serviceAccount.create({
      data: {
        meta: { title: "sa" },
      },
      select: { id: true },
    })

    const apiKey = await projectDatabase.apiKey.create({
      data: {
        meta: { title: "key" },
        serviceAccountId: serviceAccount.id,
        token: createId(),
      },
      select: { id: true },
    })

    await service.syncProject(project.id)

    const refs = await database.backend.object.findMany({
      where: { projectId: project.id },
      select: { id: true },
    })

    const refIds = new Set(refs.map(r => r.id))
    expect(refIds).toContain(operation.id)
    expect(refIds).toContain(state.id)
    expect(refIds).toContain(artifact.id)
    expect(refIds).toContain(page.id)
    expect(refIds).toContain(secret.id)
    expect(refIds).toContain(serviceAccount.id)
    expect(refIds).toContain(apiKey.id)
  })

  test("syncProject prunes stale object ids", async ({
    database,
    projectDatabase,
    project,
    logger,
  }) => {
    const service = new ObjectRefIndexService(database, logger)

    const operation = await projectDatabase.operation.create({
      data: {
        meta: { title: "op" },
        type: "update",
        options: {},
        requestedInstanceIds: [],
      },
      select: { id: true },
    })

    await service.syncProject(project.id)
    await projectDatabase.operation.delete({ where: { id: operation.id } })
    await service.syncProject(project.id)

    const refs = await database.backend.object.findMany({
      where: { projectId: project.id, id: operation.id },
      select: { id: true },
    })

    expect(refs).toHaveLength(0)
  })
})
