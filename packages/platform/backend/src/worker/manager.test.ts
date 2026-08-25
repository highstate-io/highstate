import type { ApiKeyService, ProjectUnlockService } from "../business"
import type { PubSubManager } from "../pubsub"
import type { WorkerBackend, WorkerRunOptions } from "./abstractions"
import { randomBytes } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { vi } from "vitest"
import { test } from "../test-utils"
import { WorkerManager, workerManagerConfig } from "./manager"

test("stops a deleted worker without persisting logs or restarting it", async ({
  database,
  project,
  projectDatabase,
  logger,
  expect,
}) => {
  const worker = await projectDatabase.worker.create({
    data: {
      identity: `ghcr.io/org/${createId()}`,
      serviceAccount: {
        create: { meta: { title: "Test Worker Service Account" } },
      },
    },
  })
  const apiKey = await projectDatabase.apiKey.create({
    data: {
      meta: { title: "Test Worker API Key" },
      serviceAccountId: worker.serviceAccountId,
    },
  })
  const workerVersion = await projectDatabase.workerVersion.create({
    data: {
      workerId: worker.id,
      apiKeyId: apiKey.id,
      digest: randomBytes(32).toString("hex"),
      meta: { title: "Test Worker Version" },
    },
  })

  let runOptions: WorkerRunOptions | undefined
  const workerBackend: WorkerBackend = {
    run: vi.fn(async options => {
      runOptions = options
      await new Promise<void>(resolve => options.signal?.addEventListener("abort", () => resolve()))
    }),
  }
  const workerManager = new WorkerManager(
    workerManagerConfig.parse({}),
    createId(),
    workerBackend,
    vi.mockObject({ registerUnlockTask: vi.fn() } as unknown as ProjectUnlockService),
    vi.mockObject({
      regenerateToken: vi.fn().mockResolvedValue({ apiKey, token: "worker-api-key" }),
    } as unknown as ApiKeyService),
    database,
    vi.mockObject({ publish: vi.fn() } as unknown as PubSubManager),
    logger,
  )

  await Promise.all([workerManager.syncWorkers(project.id), workerManager.syncWorkers(project.id)])
  await vi.waitFor(() => expect(runOptions).toBeDefined())
  expect(workerBackend.run).toHaveBeenCalledTimes(1)

  runOptions!.stdout.write("late worker output\n")
  await projectDatabase.workerVersion.delete({ where: { id: workerVersion.id } })

  await expect(workerManager.syncWorkers(project.id)).resolves.toBeUndefined()
  await vi.waitFor(() => expect(workerBackend.run).toHaveBeenCalledTimes(1))
  await expect(
    projectDatabase.workerVersionLog.findMany({ where: { workerVersionId: workerVersion.id } }),
  ).resolves.toEqual([])
})

test("contains an aborted worker rejection during restart", async ({
  database,
  project,
  projectDatabase,
  logger,
  expect,
}) => {
  const worker = await projectDatabase.worker.create({
    data: {
      identity: `ghcr.io/org/${createId()}`,
      serviceAccount: {
        create: { meta: { title: "Test Worker Service Account" } },
      },
    },
  })
  const apiKey = await projectDatabase.apiKey.create({
    data: {
      meta: { title: "Test Worker API Key" },
      serviceAccountId: worker.serviceAccountId,
    },
  })
  const workerVersion = await projectDatabase.workerVersion.create({
    data: {
      workerId: worker.id,
      apiKeyId: apiKey.id,
      digest: randomBytes(32).toString("hex"),
      meta: { title: "Test Worker Version" },
      runtimeId: "runtime",
    },
  })

  const workerBackend: WorkerBackend = {
    run: vi.fn(
      async options =>
        await new Promise<void>((_, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          )
        }),
    ),
  }
  const workerManager = new WorkerManager(
    workerManagerConfig.parse({}),
    "runtime",
    workerBackend,
    vi.mockObject({ registerUnlockTask: vi.fn() } as unknown as ProjectUnlockService),
    vi.mockObject({
      regenerateToken: vi.fn().mockResolvedValue({ apiKey, token: "worker-api-key" }),
    } as unknown as ApiKeyService),
    database,
    vi.mockObject({ publish: vi.fn() } as unknown as PubSubManager),
    logger,
  )

  await workerManager.syncWorkers(project.id)
  await vi.waitFor(() => expect(workerBackend.run).toHaveBeenCalledTimes(1))

  await expect(
    workerManager.restartWorkerVersion(project.id, workerVersion.id),
  ).resolves.toBeUndefined()
  await vi.waitFor(() => expect(workerBackend.run).toHaveBeenCalledTimes(2))
})
