import type { ProjectUnlockBackend } from "../unlock"
import { createId } from "@paralleldrive/cuid2"
import { describe, type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { GlobalSearchService } from "./global-search"

const globalSearchTest = test.extend<{
  projectUnlockBackend: MockedObject<ProjectUnlockBackend>
  globalSearchService: GlobalSearchService
}>({
  projectUnlockBackend: async ({}, use) => {
    const projectUnlockBackend = vi.mockObject({
      checkProjectUnlocked: vi.fn().mockResolvedValue(false),
      getProjectMasterKey: vi.fn().mockResolvedValue(null),
      unlockProject: vi.fn().mockResolvedValue(undefined),
      lockProject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProjectUnlockBackend)

    await use(projectUnlockBackend)
  },

  globalSearchService: async ({ database, projectUnlockBackend, logger }, use) => {
    const service = new GlobalSearchService(
      database,
      projectUnlockBackend,
      logger.child({ service: "GlobalSearchService" }),
    )

    await use(service)
  },
})

describe("searchByText", () => {
  globalSearchTest(
    "returns hits only from unlocked projects",
    async ({
      database,
      createProject,
      project,
      projectUnlockBackend,
      globalSearchService,
      expect,
    }) => {
      // arrange
      const lockedProject = await createProject("locked")

      projectUnlockBackend.checkProjectUnlocked.mockImplementation(async projectId => {
        return projectId === project.id
      })

      const unlockedDb = await database.forProject(project.id)
      const lockedDb = await database.forProject(lockedProject.id)

      const unlockedOperationId = createId()
      await unlockedDb.operation.create({
        data: {
          id: unlockedOperationId,
          meta: { title: "Deploy application" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
        },
      })

      const lockedOperationId = createId()
      await lockedDb.operation.create({
        data: {
          id: lockedOperationId,
          meta: { title: "Deploy locked project" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
        },
      })

      // act
      const result = await globalSearchService.searchByText("deploy")

      // assert
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].projectId).toBe(project.id)

      const operationHits = result.projects[0].hits.filter(h => h.kind === "operation")
      expect(operationHits.map(h => h.id)).toEqual([unlockedOperationId])
    },
  )

  globalSearchTest(
    "matches instance states by instanceId",
    async ({ database, project, projectUnlockBackend, globalSearchService, expect }) => {
      // arrange
      projectUnlockBackend.checkProjectUnlocked.mockResolvedValue(true)

      const db = await database.forProject(project.id)

      const stateId = createId()
      const instanceId = "component.v1:my-instance-123"

      await db.instanceState.create({
        data: {
          id: stateId,
          instanceId,
          status: "undeployed",
          source: "resident",
          kind: "unit",
        },
      })

      // act
      const result = await globalSearchService.searchByText("my-instance")

      // assert
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].projectId).toBe(project.id)

      const hits = result.projects[0].hits.filter(h => h.kind === "instanceState")
      expect(hits).toHaveLength(1)
      expect(hits[0].id).toBe(stateId)
      expect(hits[0].meta.title).toBe(instanceId)
      expect(hits[0].meta.description).toBe("undeployed")
    },
  )

  globalSearchTest(
    "returns empty result for empty query",
    async ({ projectUnlockBackend, globalSearchService, expect }) => {
      // arrange
      projectUnlockBackend.checkProjectUnlocked.mockResolvedValue(true)

      // act
      const result = await globalSearchService.searchByText("   ")

      // assert
      expect(result.projects).toEqual([])
    },
  )
})

describe("searchByIds", () => {
  globalSearchTest(
    "returns empty result for empty ids",
    async ({ globalSearchService, expect }) => {
      // act
      const result = await globalSearchService.searchByIds([])

      // assert
      expect(result).toEqual([])
    },
  )

  globalSearchTest(
    "marks projects as locked when the project is locked",
    async ({ database, project, projectUnlockBackend, globalSearchService, expect }) => {
      // arrange
      projectUnlockBackend.checkProjectUnlocked.mockResolvedValue(false)

      const objectId = createId()
      await database.backend.object.create({
        data: {
          id: objectId,
          projectId: project.id,
        },
      })

      // act
      const result = await globalSearchService.searchByIds([objectId])

      // assert
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(objectId)
      expect(result[0].projects).toEqual([{ projectId: project.id, unlockState: "locked" }])
    },
  )

  globalSearchTest(
    "returns hits for unlocked projects and does not leak details for locked ones",
    async ({
      database,
      createProject,
      project,
      projectUnlockBackend,
      globalSearchService,
      expect,
    }) => {
      // arrange
      const lockedProject = await createProject(`locked-ids-${createId()}`)

      projectUnlockBackend.checkProjectUnlocked.mockImplementation(async projectId => {
        return projectId === project.id
      })

      const objectId = createId()
      await database.backend.object.createMany({
        data: [
          { id: objectId, projectId: project.id },
          { id: objectId, projectId: lockedProject.id },
        ],
      })

      const unlockedDb = await database.forProject(project.id)
      await unlockedDb.operation.create({
        data: {
          id: objectId,
          meta: { title: "Deploy application" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
        },
      })

      // act
      const result = await globalSearchService.searchByIds([objectId])

      // assert
      expect(result).toHaveLength(1)

      const projectResults = result[0].projects
      expect(projectResults).toHaveLength(2)

      const unlocked = projectResults.find(p => p.projectId === project.id)
      expect(unlocked).toEqual({
        projectId: project.id,
        unlockState: "unlocked",
        hits: [
          {
            kind: "operation",
            id: objectId,
            meta: { title: "Deploy application" },
          },
        ],
      })

      const locked = projectResults.find(p => p.projectId === lockedProject.id)
      expect(locked).toEqual({ projectId: lockedProject.id, unlockState: "locked" })
    },
  )

  globalSearchTest(
    "returns unlocked projects with empty hits when the indexed object is not found in curated collections",
    async ({ database, project, projectUnlockBackend, globalSearchService, expect }) => {
      // arrange
      projectUnlockBackend.checkProjectUnlocked.mockResolvedValue(true)

      const objectId = createId()
      await database.backend.object.create({
        data: {
          id: objectId,
          projectId: project.id,
        },
      })

      // act
      const result = await globalSearchService.searchByIds([objectId])

      // assert
      expect(result).toHaveLength(1)
      expect(result[0].projects).toEqual([
        {
          projectId: project.id,
          unlockState: "unlocked",
          hits: [],
        },
      ])
    },
  )

  globalSearchTest(
    "returns unlocked projects with empty hits when project database access fails",
    async ({ database, createProject, projectUnlockBackend, logger, expect }) => {
      // arrange
      const projectA = await createProject(`aa-${createId()}`)
      const projectB = await createProject(`bb-${createId()}`)

      projectUnlockBackend.checkProjectUnlocked.mockResolvedValue(true)

      const objectId = createId()
      await database.backend.object.createMany({
        data: [
          { id: objectId, projectId: projectA.id },
          { id: objectId, projectId: projectB.id },
        ],
      })

      const unlockedDb = await database.forProject(projectA.id)
      await unlockedDb.operation.create({
        data: {
          id: objectId,
          meta: { title: "Deploy application" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
        },
      })

      const failingDatabase = {
        backend: database.backend,
        isEncryptionEnabled: database.isEncryptionEnabled,
        updateBackendUnlockRecipients: async () => {},
        getProjectMasterKey: async () => undefined,
        setupDatabase: async () => {
          throw new Error("not implemented")
        },
        forProject: async (projectId: string) => {
          if (projectId === projectB.id) {
            throw new Error("boom")
          }

          return await database.forProject(projectId)
        },
      }

      const service = new GlobalSearchService(
        failingDatabase as never,
        projectUnlockBackend,
        logger.child({ service: "GlobalSearchService" }),
      )

      // act
      const result = await service.searchByIds([objectId])

      // assert
      expect(result).toHaveLength(1)

      const byProjectId = new Map(result[0].projects.map(p => [p.projectId, p]))
      expect(byProjectId.get(projectA.id)).toEqual({
        projectId: projectA.id,
        unlockState: "unlocked",
        hits: [
          {
            kind: "operation",
            id: objectId,
            meta: { title: "Deploy application" },
          },
        ],
      })

      expect(byProjectId.get(projectB.id)).toEqual({
        projectId: projectB.id,
        unlockState: "unlocked",
        hits: [],
      })
    },
  )
})
