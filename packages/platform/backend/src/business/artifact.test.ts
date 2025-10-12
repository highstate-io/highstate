import type { ArtifactBackend } from "../artifact"
import { createId } from "@paralleldrive/cuid2"
import { describe, type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { ArtifactService, artifactChunkSize } from "./artifact"

const createContent = async function* (text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text)
}

const artifactTest = test.extend<{
  artifactBackend: MockedObject<ArtifactBackend>
  artifactService: ArtifactService
}>({
  artifactBackend: async ({}, use) => {
    const artifactBackend = vi.mockObject({
      store: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArtifactBackend)

    await use(artifactBackend)
  },

  artifactService: async ({ database, artifactBackend, logger }, use) => {
    const service = new ArtifactService(
      database,
      artifactBackend,
      logger.child({ service: "ArtifactService" }),
    )

    await use(service)
  },
})

describe("store", () => {
  artifactTest(
    "stores new artifact successfully",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 1024

      // act
      const artifact = await artifactService.store(
        project.id,
        hash,
        size,
        { title: "Test Artifact" },
        createContent("test content"),
        async (tx, artifact) => {
          // track callback - create a service account reference
          await tx.serviceAccount.create({
            data: {
              meta: { title: "Test SA" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert
      expect(artifact.hash).toBe(hash)
      expect(artifact.size).toBe(size)
      expect(artifact.meta).toEqual({ title: "Test Artifact" })

      // verify backend store was called with correct parameters
      expect(artifactBackend.store).toHaveBeenCalledWith(
        project.id,
        artifact.id,
        artifactChunkSize,
        expect.any(Object),
      )

      // verify artifact was created with reference
      const dbArtifact = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
        include: { serviceAccounts: true },
      })
      expect(dbArtifact?.serviceAccounts).toHaveLength(1)
      expect(dbArtifact?.serviceAccounts[0].meta).toEqual({ title: "Test SA" })
    },
  )

  artifactTest(
    "returns existing artifact when duplicate exists and backend file exists",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 50

      const existing = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta: { title: "Existing Artifact" } },
      })

      artifactBackend.exists.mockResolvedValue(true)

      // act
      const result = await artifactService.store(
        project.id,
        hash,
        size, // same size for same content
        { title: "Test Artifact" },
        createContent("content"),
        async (tx, artifact) => {
          // track callback is always called to set up new references
          await tx.serviceAccount.create({
            data: {
              meta: { title: "New reference" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert
      expect(result.id).toBe(existing.id)
      expect(result.size).toBe(size)
      expect(artifactBackend.store).not.toHaveBeenCalled()

      // verify track callback was executed - new reference was created
      const dbArtifact = await projectDatabase.artifact.findUnique({
        where: { id: result.id },
        include: { serviceAccounts: true },
      })
      expect(dbArtifact?.serviceAccounts).toHaveLength(1)
      expect(dbArtifact?.serviceAccounts[0].meta).toEqual({ title: "New reference" })
    },
  )

  artifactTest(
    "rolls back transaction when track callback fails",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 256

      // act & assert
      await expect(
        artifactService.store(
          project.id,
          hash,
          size,
          { title: "Test Artifact" },
          createContent("content"),
          async () => {
            throw new Error("Track failed")
          },
        ),
      ).rejects.toThrow("Track failed")

      // verify no artifact was created in database
      const artifact = await projectDatabase.artifact.findUnique({
        where: { hash },
      })
      expect(artifact).toBeNull()

      // verify backend store was still called (this is current behavior - backend storage happens before transaction)
      expect(artifactBackend.store).toHaveBeenCalledWith(
        project.id,
        expect.any(String),
        artifactChunkSize,
        expect.any(Object),
      )
    },
  )

  artifactTest(
    "re-uploads when artifact exists in database but not in backend",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 50

      const existing = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta: { title: "Existing Artifact" } },
      })

      artifactBackend.exists.mockResolvedValue(false)

      // act
      const result = await artifactService.store(
        project.id,
        hash,
        size,
        { title: "Test Artifact" },
        createContent("content"),
        async (tx, artifact) => {
          await tx.serviceAccount.create({
            data: {
              meta: { title: "Test SA" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert
      expect(result.id).toBe(existing.id)
      expect(artifactBackend.store).toHaveBeenCalledWith(
        project.id,
        existing.id,
        artifactChunkSize,
        expect.any(Object),
      )
    },
  )

  artifactTest(
    "stores artifact with metadata and verifies it",
    async ({ artifactService, projectDatabase, project, expect }) => {
      // arrange
      const hash = createId()
      const size = 512
      const meta = {
        title: "Deployment Artifact",
        description: "Production deployment v1.0.0",
        color: "green",
      }

      // act
      const artifact = await artifactService.store(
        project.id,
        hash,
        size,
        meta,
        createContent("test content with metadata"),
        async (tx, artifact) => {
          await tx.serviceAccount.create({
            data: {
              meta: { title: "Test SA with metadata" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert
      expect(artifact.meta).toEqual(meta)

      // verify in database
      const dbArtifact = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
      })
      expect(dbArtifact?.meta).toEqual(meta)
    },
  )

  artifactTest(
    "updates metadata when backend file exists but metadata changed",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 100
      const originalMeta = { title: "Build Artifact", description: "Initial upload" }
      const newMeta = {
        title: "Production Build Artifact",
        description: "Promoted to production environment",
        color: "blue",
      }

      // create existing artifact with original metadata
      const existing = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta: originalMeta },
      })

      artifactBackend.exists.mockResolvedValue(true) // backend file exists

      // act
      const result = await artifactService.store(
        project.id,
        hash,
        size,
        newMeta, // different metadata
        createContent("same content"),
        async (tx, artifact) => {
          await tx.serviceAccount.create({
            data: {
              meta: { title: "Updated SA" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert - metadata should be updated without re-upload
      expect(result.id).toBe(existing.id) // same artifact ID
      expect(result.meta).toEqual(newMeta)
      expect(result.size).toBe(size)

      // verify no backend re-upload occurred
      expect(artifactBackend.store).not.toHaveBeenCalled()

      // verify in database
      const dbArtifact = await projectDatabase.artifact.findUnique({
        where: { id: result.id },
        include: { serviceAccounts: true },
      })
      expect(dbArtifact?.meta).toEqual(newMeta)
      expect(dbArtifact?.serviceAccounts).toHaveLength(1)
      expect(dbArtifact?.serviceAccounts[0].meta).toEqual({ title: "Updated SA" })
    },
  )

  artifactTest(
    "returns existing artifact when metadata hasn't changed",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 100
      const meta = { title: "Build Artifact", description: "Same metadata" }

      // create existing artifact
      const existing = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta },
      })

      artifactBackend.exists.mockResolvedValue(true)

      // act
      const result = await artifactService.store(
        project.id,
        hash,
        size,
        meta, // same metadata
        createContent("same content"),
        async (tx, artifact) => {
          // track callback is always called to set up new references
          await tx.serviceAccount.create({
            data: {
              meta: { title: "Another reference" },
              artifacts: { connect: { id: artifact.id } },
            },
          })
        },
      )

      // assert - should return existing artifact without changes
      expect(result.id).toBe(existing.id)
      expect(result.meta).toEqual(meta)
      expect(artifactBackend.store).not.toHaveBeenCalled()

      // verify track callback was executed - new reference was created
      const dbArtifact = await projectDatabase.artifact.findUnique({
        where: { id: result.id },
        include: { serviceAccounts: true },
      })
      expect(dbArtifact?.serviceAccounts).toHaveLength(1)
      expect(dbArtifact?.serviceAccounts[0].meta).toEqual({ title: "Another reference" })
    },
  )
})

describe("collectGarbage", () => {
  artifactTest(
    "deletes artifacts with no references",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 512

      const orphan = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta: { title: "Orphan Artifact" } },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // verify artifact deleted from database
      const deleted = await projectDatabase.artifact.findUnique({
        where: { id: orphan.id },
      })
      expect(deleted).toBeNull()

      // verify backend deletion called
      expect(artifactBackend.delete).toHaveBeenCalledWith(project.id, hash)
    },
  )

  artifactTest(
    "keeps artifacts with ServiceAccount references",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 1024

      const artifact = await projectDatabase.artifact.create({
        data: {
          hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Referenced Artifact" },
          serviceAccounts: {
            create: { meta: { title: "Test SA" } },
          },
        },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // verify artifact still exists
      const existing = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
      })
      expect(existing).not.toBeNull()

      // verify no backend deletion
      expect(artifactBackend.delete).not.toHaveBeenCalled()
    },
  )

  artifactTest(
    "keeps artifacts with Instance references",
    async ({
      artifactService,
      projectDatabase,
      project,
      artifactBackend,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const hash = createId()
      const size = 1024
      const instance = await createInstanceState(project.id)

      const artifact = await projectDatabase.artifact.create({
        data: {
          hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Instance Artifact" },
          instances: {
            connect: { id: instance.id },
          },
        },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // verify artifact still exists
      const existing = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
      })
      expect(existing).not.toBeNull()

      // verify no backend deletion
      expect(artifactBackend.delete).not.toHaveBeenCalled()
    },
  )

  artifactTest(
    "keeps artifacts with Terminal references",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 1024

      // create service account first
      const serviceAccount = await projectDatabase.serviceAccount.create({
        data: { meta: { title: "Terminal SA" } },
      })

      // create terminal
      const terminal = await projectDatabase.terminal.create({
        data: {
          meta: { title: "Test Terminal" },
          spec: { type: "bash", environment: {} },
          serviceAccountId: serviceAccount.id,
        },
      })

      // create artifact with terminal reference
      const artifact = await projectDatabase.artifact.create({
        data: {
          hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Terminal Artifact" },
          terminals: {
            connect: { id: terminal.id },
          },
        },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // verify artifact still exists
      const existing = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
      })
      expect(existing).not.toBeNull()

      // verify no backend deletion
      expect(artifactBackend.delete).not.toHaveBeenCalled()
    },
  )

  artifactTest(
    "keeps artifacts with Page references",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const hash = createId()
      const size = 1024

      // create service account first
      const serviceAccount = await projectDatabase.serviceAccount.create({
        data: { meta: { title: "Page SA" } },
      })

      // create page
      const page = await projectDatabase.page.create({
        data: {
          meta: { title: "Test Page" },
          content: { type: "markdown", data: "# Test Page" },
          serviceAccountId: serviceAccount.id,
        },
      })

      // create artifact with page reference
      const artifact = await projectDatabase.artifact.create({
        data: {
          hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Page Artifact" },
          pages: {
            connect: { id: page.id },
          },
        },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // verify artifact still exists
      const existing = await projectDatabase.artifact.findUnique({
        where: { id: artifact.id },
      })
      expect(existing).not.toBeNull()

      // verify no backend deletion
      expect(artifactBackend.delete).not.toHaveBeenCalled()
    },
  )

  artifactTest(
    "handles backend deletion failures gracefully",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      artifactBackend.delete.mockRejectedValue(new Error("Backend error"))

      const hash = createId()
      const size = 256

      const orphan = await projectDatabase.artifact.create({
        data: { hash, size, chunkSize: artifactChunkSize, meta: { title: "Orphan Artifact" } },
      })

      // act & assert
      // should not throw
      await expect(artifactService.collectGarbage(project.id)).resolves.toBeUndefined()

      // database cleanup still succeeded
      const deleted = await projectDatabase.artifact.findUnique({
        where: { id: orphan.id },
      })
      expect(deleted).toBeNull()

      // verify backend deletion was attempted
      expect(artifactBackend.delete).toHaveBeenCalledWith(project.id, hash)
    },
  )

  artifactTest(
    "handles mixed scenario with referenced and unreferenced artifacts",
    async ({ artifactService, projectDatabase, project, artifactBackend, expect }) => {
      // arrange
      const referencedHash = createId()
      const orphan1Hash = createId()
      const orphan2Hash = createId()
      const size = 2048

      const referenced = await projectDatabase.artifact.create({
        data: {
          hash: referencedHash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Referenced Artifact" },
          serviceAccounts: {
            create: { meta: { title: "Test SA" } },
          },
        },
      })

      const orphan1 = await projectDatabase.artifact.create({
        data: {
          hash: orphan1Hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Orphan 1" },
        },
      })

      const orphan2 = await projectDatabase.artifact.create({
        data: {
          hash: orphan2Hash,
          size,
          chunkSize: artifactChunkSize,
          meta: { title: "Orphan 2" },
        },
      })

      // act
      await artifactService.collectGarbage(project.id)

      // assert
      // referenced artifact should still exist
      const stillExists = await projectDatabase.artifact.findUnique({
        where: { id: referenced.id },
      })
      expect(stillExists).not.toBeNull()

      // orphaned artifacts should be deleted
      const deleted1 = await projectDatabase.artifact.findUnique({
        where: { id: orphan1.id },
      })
      const deleted2 = await projectDatabase.artifact.findUnique({
        where: { id: orphan2.id },
      })
      expect(deleted1).toBeNull()
      expect(deleted2).toBeNull()

      // verify backend deletions called for orphans only
      expect(artifactBackend.delete).toHaveBeenCalledTimes(2)
      expect(artifactBackend.delete).toHaveBeenCalledWith(project.id, orphan1Hash)
      expect(artifactBackend.delete).toHaveBeenCalledWith(project.id, orphan2Hash)
    },
  )
})
