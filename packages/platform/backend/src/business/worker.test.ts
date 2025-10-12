import type { UnitWorker } from "@highstate/contract"
import type { Worker, WorkerVersion } from "../database"
import type { PubSubManager } from "../pubsub"
import type { WorkerManager } from "../worker"
import { randomBytes } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { describe, vi } from "vitest"
import { extractDigestFromImage } from "../shared"
import { test } from "../test-utils"
import { WorkerService } from "./worker"

const workerTest = test.extend<{
  workerService: WorkerService

  createWorker(): Promise<Worker>

  createWorkerVersion: (
    worker: Worker,
    overrides?: Pick<Partial<WorkerVersion>, "digest">,
  ) => Promise<WorkerVersion>

  createMockUnitWorker: (overrides?: Partial<UnitWorker>) => UnitWorker
}>({
  workerService: async ({ database, logger }, use) => {
    const workerManager = vi.mockObject({ syncWorkers: vi.fn() } as unknown as WorkerManager)

    const workerService = new WorkerService(
      database,
      workerManager,
      vi.mockObject({ subscribe: vi.fn(), publish: vi.fn() } as unknown as PubSubManager),
      logger.child({ service: "WorkerService" }),
    )

    await use(workerService)
  },

  createWorker: async ({ projectDatabase }, use) => {
    const createWorker = async () => {
      return await projectDatabase.worker.create({
        data: {
          identity: `ghcr.io/org/${createId()}`,
          serviceAccount: {
            create: {
              meta: {
                title: "Test Worker Service Account",
              },
            },
          },
        },
      })
    }

    await use(createWorker)
  },

  createWorkerVersion: async ({ projectDatabase }, use) => {
    const createWorkerVersion = async (
      worker: Worker,
      overrides: Pick<Partial<WorkerVersion>, "digest"> = {},
    ) => {
      return await projectDatabase.workerVersion.create({
        data: {
          worker: { connect: worker },
          digest: createId(),
          meta: {
            title: "Test Worker Version",
            description: "Test worker version for testing purposes",
          },
          apiKey: {
            create: {
              meta: {
                title: "Test Worker API Key",
              },
              serviceAccountId: worker.serviceAccountId,
              token: createId(),
            },
          },
          ...overrides,
        },
      })
    }

    await use(createWorkerVersion)
  },

  createMockUnitWorker: async ({}, use) => {
    const createMockUnitWorker = (overrides: Partial<UnitWorker> = {}): UnitWorker => ({
      name: "test-worker",
      image: `ghcr.io/org/${createId()}@sha256:${randomBytes(32).toString("hex")}`,
      params: { key: "value" },
      ...overrides,
    })

    await use(createMockUnitWorker)
  },
})

describe("updateUnitRegistrations", () => {
  workerTest(
    "creates new worker registrations for unit workers",
    async ({
      workerService,
      project,
      projectDatabase,
      createInstanceState,
      createMockUnitWorker,
      expect,
    }) => {
      // arrange
      const unitWorker = createMockUnitWorker()
      const instance = await createInstanceState(project.id)

      // act
      await projectDatabase.$transaction(async tx => {
        await workerService.updateUnitRegistrations(tx, project.id, instance.id, [unitWorker])
      })

      // assert
      const registrations = await projectDatabase.workerUnitRegistration.findMany({
        where: { stateId: instance.id },
      })

      // check that the registration was created with the correct data
      expect(registrations).toHaveLength(1)
      expect(registrations[0].name).toBe(unitWorker.name)
      expect(registrations[0].params).toEqual(unitWorker.params)
      expect(registrations[0].workerVersionId).toBeDefined()
      expect(registrations[0].stateId).toBe(instance.id)
    },
  )

  workerTest(
    "updates existing worker registrations with new params",
    async ({
      workerService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      createMockUnitWorker,
      expect,
    }) => {
      // arrange
      const unitWorker = createMockUnitWorker({ params: { key: "newValue" } })
      const instance = await createInstanceState(project.id)

      // create initial worker and version
      const worker = await createWorker()
      const workerVersion = await createWorkerVersion(worker, {
        digest: extractDigestFromImage(unitWorker.image),
      })

      // create an initial registration
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: instance.id,
          name: unitWorker.name,
          params: { key: "oldValue" },
          workerVersionId: workerVersion.id,
        },
      })

      // act
      await projectDatabase.$transaction(async tx => {
        await workerService.updateUnitRegistrations(tx, project.id, instance.id, [unitWorker])
      })

      // assert
      const updatedRegistration = await projectDatabase.workerUnitRegistration.findFirst({
        where: { stateId: instance.id, name: unitWorker.name },
      })

      expect(updatedRegistration).toBeDefined()
      expect(updatedRegistration?.params).toEqual(unitWorker.params)
      expect(updatedRegistration?.workerVersionId).toBe(workerVersion.id)
    },
  )

  workerTest(
    "creates new worker version while keeping existing one when both are in use",
    async ({
      workerService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      createMockUnitWorker,
      expect,
    }) => {
      // arrange
      const oldDigest = randomBytes(32).toString("hex")
      const newDigest = randomBytes(32).toString("hex")

      const worker = await createWorker()
      const oldWorkerVersion = await createWorkerVersion(worker, { digest: oldDigest })

      // create two instances, both using the same worker version initially
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)

      // create registrations for both instances using the old version
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: instance1.id,
          name: "test-worker",
          params: { key: "value1" },
          workerVersionId: oldWorkerVersion.id,
        },
      })

      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: instance2.id,
          name: "test-worker",
          params: { key: "value2" },
          workerVersionId: oldWorkerVersion.id,
        },
      })

      // act - update only instance1 to use new worker version
      const newUnitWorker = createMockUnitWorker({
        image: `${worker.identity}@sha256:${newDigest}`,
        params: { key: "newValue" },
      })

      await projectDatabase.$transaction(async tx => {
        await workerService.updateUnitRegistrations(tx, project.id, instance1.id, [newUnitWorker])
      })

      // assert
      const instance1Registration = await projectDatabase.workerUnitRegistration.findFirst({
        where: { stateId: instance1.id, name: "test-worker" },
        include: { workerVersion: true },
      })

      const instance2Registration = await projectDatabase.workerUnitRegistration.findFirst({
        where: { stateId: instance2.id, name: "test-worker" },
        include: { workerVersion: true },
      })

      // verify instance1 now uses new version
      expect(instance1Registration?.workerVersion.digest).toBe(newDigest)
      expect(instance1Registration?.params).toEqual({ key: "newValue" })

      // verify instance2 still uses old version
      expect(instance2Registration?.workerVersion.digest).toBe(oldDigest)
      expect(instance2Registration?.params).toEqual({ key: "value2" })

      // verify both worker versions still exist (no cleanup since both are in use)
      const allVersions = await projectDatabase.workerVersion.findMany({
        where: { workerId: worker.id },
      })
      expect(allVersions).toHaveLength(2)
      expect(allVersions.map(v => v.digest).sort()).toEqual([oldDigest, newDigest].sort())
    },
  )

  workerTest(
    "creates new worker version and deletes old unused one",
    async ({
      workerService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      createMockUnitWorker,
      expect,
    }) => {
      // arrange
      const oldDigest = randomBytes(32).toString("hex")
      const newDigest = randomBytes(32).toString("hex")

      const worker = await createWorker()
      const oldWorkerVersion = await createWorkerVersion(worker, { digest: oldDigest })

      const instance = await createInstanceState(project.id)

      // create registration using old version
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: instance.id,
          name: "test-worker",
          params: { key: "oldValue" },
          workerVersionId: oldWorkerVersion.id,
        },
      })

      // act - update to use new worker version
      const newUnitWorker = createMockUnitWorker({
        image: `${worker.identity}@sha256:${newDigest}`,
        params: { key: "newValue" },
      })

      await projectDatabase.$transaction(async tx => {
        await workerService.updateUnitRegistrations(tx, project.id, instance.id, [newUnitWorker])
      })

      // assert
      const registration = await projectDatabase.workerUnitRegistration.findFirst({
        where: { stateId: instance.id, name: "test-worker" },
        include: { workerVersion: true },
      })

      // verify registration now uses new version
      expect(registration?.workerVersion.digest).toBe(newDigest)
      expect(registration?.params).toEqual({ key: "newValue" })

      // verify old version was cleaned up
      const oldVersion = await projectDatabase.workerVersion.findFirst({
        where: { digest: oldDigest, workerId: worker.id },
      })
      expect(oldVersion).toBeNull()

      // verify new version exists
      const newVersion = await projectDatabase.workerVersion.findFirst({
        where: { digest: newDigest, workerId: worker.id },
      })
      expect(newVersion).toBeDefined()
    },
  )

  workerTest(
    "removes all registrations and cleans up unused worker versions when unit workers list is empty",
    async ({
      workerService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      // arrange
      const worker1 = await createWorker()
      const worker2 = await createWorker()

      const digest1 = randomBytes(32).toString("hex")
      const digest2 = randomBytes(32).toString("hex")

      const version1 = await createWorkerVersion(worker1, { digest: digest1 })
      const version2 = await createWorkerVersion(worker2, { digest: digest2 })

      const instance = await createInstanceState(project.id)

      console.log(instance.id, version1.id, version2.id)

      // create multiple registrations
      await projectDatabase.workerUnitRegistration.createMany({
        data: [
          {
            stateId: instance.id,
            name: "worker1",
            params: { key: "value1" },
            workerVersionId: version1.id,
          },
          {
            stateId: instance.id,
            name: "worker2",
            params: { key: "value2" },
            workerVersionId: version2.id,
          },
        ],
      })

      // act - update with empty workers list
      await projectDatabase.$transaction(async tx => {
        await workerService.updateUnitRegistrations(tx, project.id, instance.id, [])
      })

      // assert
      const remainingRegistrations = await projectDatabase.workerUnitRegistration.findMany({
        where: { stateId: instance.id },
      })
      expect(remainingRegistrations).toHaveLength(0)

      // verify unused worker versions were cleaned up
      const remainingVersions = await projectDatabase.workerVersion.findMany({
        where: {
          OR: [
            { digest: digest1, workerId: worker1.id },
            { digest: digest2, workerId: worker2.id },
          ],
        },
      })
      expect(remainingVersions).toHaveLength(0)
    },
  )
})
