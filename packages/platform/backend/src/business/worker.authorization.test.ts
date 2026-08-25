import type { Worker, WorkerVersion } from "../database"
import type { PubSubManager } from "../pubsub"
import type { WorkerManager } from "../worker"
import { createId } from "@paralleldrive/cuid2"
import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { WorkerService } from "./worker"

const authorizationTest = test.extend<{
  service: WorkerService
  createWorker: () => Promise<Worker>
  createVersion: (worker: Worker) => Promise<WorkerVersion>
}>({
  service: async ({ database, logger }, use) => {
    await use(
      new WorkerService(
        database,
        vi.mockObject({ syncWorkers: vi.fn() } as unknown as WorkerManager),
        vi.mockObject({ subscribe: vi.fn(), publish: vi.fn() } as unknown as PubSubManager),
        logger,
      ),
    )
  },
  createWorker: async ({ projectDatabase }, use) => {
    await use(
      async () =>
        await projectDatabase.worker.create({
          data: {
            identity: `ghcr.io/org/${createId()}`,
            serviceAccount: { create: { meta: { title: "Worker" } } },
          },
        }),
    )
  },
  createVersion: async ({ projectDatabase }, use) => {
    await use(
      async worker =>
        await projectDatabase.workerVersion.create({
          data: {
            worker: { connect: worker },
            digest: createId(),
            meta: { title: "Version" },
            apiKey: {
              create: { meta: { title: "Key" }, serviceAccountId: worker.serviceAccountId },
            },
          },
        }),
    )
  },
})

describe("WorkerService authorization", () => {
  authorizationTest(
    "requires worker.manage for version metadata updates",
    async ({ service, project, createWorker, createVersion }) => {
      const worker = await createWorker()
      const version = await createVersion(worker)

      await expect(
        service.updateWorkerVersionMeta(createProjectRequestContext(project.id), version.id, {
          title: "Updated",
        }),
      ).rejects.toThrow(PermissionDeniedError)

      await expect(
        service.updateWorkerVersionMeta(
          createProjectRequestContext(
            project.id,
            grantProjectPermission("worker.manage", [
              { type: "resources", resourceIds: [version.id] },
            ]),
          ),
          version.id,
          { title: "Updated" },
        ),
      ).rejects.toThrow(PermissionDeniedError)
      await expect(
        service.updateWorkerVersionMeta(
          createProjectRequestContext(
            project.id,
            grantProjectPermission("worker.manage", [
              { type: "resources", resourceIds: [worker.id] },
              { type: "owners", serviceAccountIds: [worker.serviceAccountId] },
              { type: "workers", workerIds: [worker.id] },
            ]),
          ),
          version.id,
          { title: "Updated" },
        ),
      ).resolves.toBeUndefined()
    },
  )

  authorizationTest(
    "requires worker-version.get for version logs",
    async ({ service, project, createWorker, createVersion }) => {
      const worker = await createWorker()
      const version = await createVersion(worker)

      await expect(
        service.getWorkerVersionLogs(createProjectRequestContext(project.id), version.id),
      ).rejects.toThrow(PermissionDeniedError)
      await expect(
        service.getWorkerVersionLogs(
          createProjectRequestContext(
            project.id,
            grantProjectPermission("worker-version.get", [
              { type: "workers", workerIds: [worker.id] },
            ]),
          ),
          version.id,
        ),
      ).resolves.toEqual([])
    },
  )
})
