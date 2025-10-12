import type { CommonObjectMeta } from "@highstate/contract"
import type { ProjectTransaction } from "../database"
import { describe, type MockedObject, vi } from "vitest"
import { MemoryPubSubBackend, PubSubManager } from "../pubsub"
import { type InstanceLockEvent, InstanceLockLostError } from "../shared"
import { test } from "../test-utils"
import { InstanceLockService } from "./instance-lock"

const instanceLockTest = test.extend<{
  pubsubManager: MockedObject<PubSubManager>
  instanceLockService: InstanceLockService
}>({
  pubsubManager: async ({ logger }, use) => {
    const pubsubBackend = new MemoryPubSubBackend(logger)

    const realPubsubManager = new PubSubManager(
      pubsubBackend,
      logger.child({ service: "PubSubManager" }),
    )

    // create a mock that preserves both subscribe and publish functionality for real event flow
    const mockPubsubManager = vi.mockObject(realPubsubManager)
    mockPubsubManager.subscribe.mockImplementation(
      realPubsubManager.subscribe.bind(realPubsubManager),
    )
    mockPubsubManager.publish.mockImplementation(realPubsubManager.publish.bind(realPubsubManager))

    await use(mockPubsubManager)
  },

  instanceLockService: async ({ database, pubsubManager, logger }, use) => {
    const service = new InstanceLockService(
      database,
      pubsubManager,
      logger.child({ service: "InstanceLockService" }),
    )

    await use(service)
  },
})

describe("tryLockInstances", () => {
  instanceLockTest(
    "successfully locks available instances",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const stateIds = [instance1.id, instance2.id]
      const lockMeta: CommonObjectMeta = { title: "Test Operation Lock" }

      // act
      const [token, lockedStateIds] = await instanceLockService.tryLockInstances(
        project.id,
        stateIds,
        lockMeta,
      )

      // assert
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual(stateIds)

      // verify locks were created in database
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(locks).toHaveLength(2)
      expect(locks[0].meta).toEqual(lockMeta)
      expect(locks[0].token).toBe(token)
      expect(locks[1].meta).toEqual(lockMeta)
      expect(locks[1].token).toBe(token)

      // verify publish was called
      expect(pubsubManager.publish).toHaveBeenCalledWith(
        ["instance-lock", project.id],
        expect.objectContaining({
          type: "locked",
          locks: expect.arrayContaining([
            expect.objectContaining({
              stateId: instance1.id,
              token: expect.any(String),
              meta: lockMeta,
              acquiredAt: expect.any(Date),
            }),
            expect.objectContaining({
              stateId: instance2.id,
              token: expect.any(String),
              meta: lockMeta,
              acquiredAt: expect.any(Date),
            }),
          ]),
        }),
      )
    },
  )

  instanceLockTest(
    "returns false when instances are already locked and partial lock not allowed",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const stateIds = [instance1.id, instance2.id]

      // create existing lock on first instance
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Existing Lock" },
          token: "existing-token-123",
        },
      })

      const lockMeta: CommonObjectMeta = { title: "New Lock" }

      // act
      const [token, lockedStateIds] = await instanceLockService.tryLockInstances(
        project.id,
        stateIds,
        lockMeta,
        undefined, // action
        false, // allowPartialLock = false
      )

      // assert
      expect(token).toBe("")
      expect(lockedStateIds).toEqual([])

      // verify no new locks were created
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance2.id },
      })
      expect(locks).toHaveLength(0)
    },
  )

  instanceLockTest(
    "locks available instances when partial lock is allowed",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const instance3 = await createInstanceState(project.id)
      const stateIds = [instance1.id, instance2.id, instance3.id]

      // create existing lock on first instance
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Existing Lock" },
          token: "existing-partial-token",
        },
      })

      const lockMeta: CommonObjectMeta = { title: "Partial Lock" }

      // act
      const [token, lockedStateIds] = await instanceLockService.tryLockInstances(
        project.id,
        stateIds,
        lockMeta,
        undefined, // action
        true, // allowPartialLock = true
      )

      // assert
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual([instance2.id, instance3.id])

      // verify only available instances were locked
      const newLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: [instance2.id, instance3.id] } },
      })
      expect(newLocks).toHaveLength(2)

      // verify publish was called with available instances
      expect(pubsubManager.publish).toHaveBeenCalledWith(
        ["instance-lock", project.id],
        expect.objectContaining({
          type: "locked",
          locks: expect.arrayContaining([
            expect.objectContaining({
              stateId: instance2.id,
              token: expect.any(String),
              meta: lockMeta,
              acquiredAt: expect.any(Date),
            }),
            expect.objectContaining({
              stateId: instance3.id,
              token: expect.any(String),
              meta: lockMeta,
              acquiredAt: expect.any(Date),
            }),
          ]),
        }),
      )
    },
  )

  instanceLockTest(
    "returns early when no instances provided",
    async ({ instanceLockService, project, pubsubManager, expect }) => {
      // arrange
      const stateIds: string[] = []
      const lockMeta: CommonObjectMeta = { title: "Empty Lock" }

      // act
      const [token, lockedStateIds] = await instanceLockService.tryLockInstances(
        project.id,
        stateIds,
        lockMeta,
      )

      // assert
      expect(token).toBe("")
      expect(lockedStateIds).toEqual([])
      expect(pubsubManager.publish).not.toHaveBeenCalled()
    },
  )

  instanceLockTest(
    "returns partial success when no instances are available",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const stateIds = [instance1.id]

      // create existing lock
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Existing Lock" },
          token: "existing-fail-token",
        },
      })

      const lockMeta: CommonObjectMeta = { title: "Failed Lock" }

      // act
      const [token, lockedStateIds] = await instanceLockService.tryLockInstances(
        project.id,
        stateIds,
        lockMeta,
        undefined, // action
        true, // allowPartialLock = true
      )

      // assert
      expect(token).toMatch(/^[0-9a-z]{24}$/) // partial success allowed
      expect(lockedStateIds).toEqual([])
    },
  )
})

describe("isInstanceLocked", () => {
  instanceLockTest(
    "returns true when instance is locked",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance.id,
          meta: { title: "Test Lock" },
          token: "test-lock-token",
        },
      })

      // act
      const isLocked = await instanceLockService.isInstanceLocked(project.id, instance.id)

      // assert
      expect(isLocked).toBe(true)
    },
  )

  instanceLockTest(
    "returns false when instance is not locked",
    async ({ instanceLockService, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)

      // act
      const isLocked = await instanceLockService.isInstanceLocked(project.id, instance.id)

      // assert
      expect(isLocked).toBe(false)
    },
  )
})

describe("unlockInstancesUnconditionally", () => {
  instanceLockTest(
    "unlocks existing locked instances",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const stateIds = [instance1.id, instance2.id]

      // create locks
      await projectDatabase.instanceLock.createMany({
        data: stateIds.map(stateId => ({
          stateId,
          meta: { title: "Lock to unlock" },
          token: "unlock-test-token",
        })),
      })

      // verify locks exist
      const locksBefore = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(locksBefore).toHaveLength(2)

      // act
      await instanceLockService.unlockInstancesUnconditionally(project.id, stateIds)

      // assert
      // verify locks were removed
      const locksAfter = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(locksAfter).toHaveLength(0)

      // verify publish was called
      expect(pubsubManager.publish).toHaveBeenCalledWith(["instance-lock", project.id], {
        type: "unlocked",
        stateIds,
      })
    },
  )

  instanceLockTest(
    "handles unlocking non-existent locks gracefully",
    async ({ instanceLockService, project, pubsubManager, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const stateIds = [instance.id]

      // act - try to unlock instance that isn't locked
      await instanceLockService.unlockInstancesUnconditionally(project.id, stateIds)

      // assert - should not throw, but also shouldn't publish since no locks were removed
      expect(pubsubManager.publish).not.toHaveBeenCalled()
    },
  )

  instanceLockTest(
    "returns early when no instances provided",
    async ({ instanceLockService, project, pubsubManager, expect }) => {
      // arrange
      const stateIds: string[] = []

      // act
      await instanceLockService.unlockInstancesUnconditionally(project.id, stateIds)

      // assert
      expect(pubsubManager.publish).not.toHaveBeenCalled()
    },
  )

  instanceLockTest(
    "unlocks only some instances when mix exists",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const instance3 = await createInstanceState(project.id)

      // lock only first two instances
      await projectDatabase.instanceLock.createMany({
        data: [
          { stateId: instance1.id, meta: { title: "Lock 1" }, token: "mix-test-token-1" },
          { stateId: instance2.id, meta: { title: "Lock 2" }, token: "mix-test-token-2" },
        ],
      })

      // act - try to unlock all three (third doesn't exist)
      await instanceLockService.unlockInstancesUnconditionally(project.id, [
        instance1.id,
        instance2.id,
        instance3.id,
      ])

      // assert
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: [instance1.id, instance2.id, instance3.id] } },
      })
      expect(remainingLocks).toHaveLength(0)

      // verify event was published for all requested instances
      expect(pubsubManager.publish).toHaveBeenCalledWith(["instance-lock", project.id], {
        type: "unlocked",
        stateIds: [instance1.id, instance2.id, instance3.id],
      })
    },
  )
})

describe("unlockInstances", () => {
  instanceLockTest(
    "successfully unlocks instances with valid token",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)

      const stateIds = [instance1.id, instance2.id]
      const token = "valid-token-123"

      // create locks with the token
      await projectDatabase.instanceLock.createMany({
        data: stateIds.map(stateId => ({
          stateId,
          meta: { title: "Lock to unlock" },
          token,
        })),
      })

      // act
      await instanceLockService.unlockInstances(project.id, stateIds, token)

      // assert
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(remainingLocks).toHaveLength(0)

      const publishCall = pubsubManager.publish.mock.calls[0]
      expect(publishCall[0]).toEqual(["instance-lock", project.id])

      const event = publishCall[1] as InstanceLockEvent & { type: "unlocked" }
      expect(event.type).toBe("unlocked")
      expect(event.stateIds).toHaveLength(stateIds.length)
      expect(event.stateIds).toEqual(expect.arrayContaining(stateIds))
    },
  )

  instanceLockTest(
    "executes unlock action when provided",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const stateIds = [instance.id]
      const token = "action-token-456"
      let actionExecuted = false

      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance.id,
          meta: { title: "Lock with action" },
          token,
        },
      })

      // act
      await instanceLockService.unlockInstances(project.id, stateIds, token, async () => {
        actionExecuted = true
      })

      // assert
      expect(actionExecuted).toBe(true)
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance.id },
      })
      expect(remainingLocks).toHaveLength(0)
    },
  )

  instanceLockTest(
    "throws InstanceLockLostError when token is invalid",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const stateIds = [instance.id]

      // create lock with different token
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance.id,
          meta: { title: "Lock with wrong token" },
          token: "correct-token-789",
        },
      })

      // act & assert
      await expect(
        instanceLockService.unlockInstances(project.id, stateIds, "wrong-token-123"),
      ).rejects.toThrow(InstanceLockLostError)

      // verify lock still exists
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance.id },
      })
      expect(locks).toHaveLength(1)
    },
  )

  instanceLockTest(
    "throws InstanceLockLostError when some instances are missing locks",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)

      const stateIds = [instance1.id, instance2.id]
      const token = "partial-token-abc"

      // create lock for only first instance
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Partial lock" },
          token,
        },
      })

      // act & assert
      await expect(
        instanceLockService.unlockInstances(project.id, stateIds, token),
      ).rejects.toThrow(InstanceLockLostError)

      // verify first lock still exists
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance1.id },
      })
      expect(locks).toHaveLength(1)
    },
  )

  instanceLockTest(
    "returns early when no instances provided",
    async ({ instanceLockService, project, pubsubManager, expect }) => {
      // arrange
      const stateIds: string[] = []
      const token = "empty-token-def"

      // act
      await instanceLockService.unlockInstances(project.id, stateIds, token)

      // assert
      expect(pubsubManager.publish).not.toHaveBeenCalled()
    },
  )
})

describe("lockInstances", () => {
  instanceLockTest(
    "successfully locks instances and executes action",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)

      const stateIds = [instance1.id, instance2.id]
      const lockMeta: CommonObjectMeta = { title: "Lock and Execute" }
      let actionCalled = false
      let actionInstanceIds: string[] = []

      const action = async (_tx: ProjectTransaction, lockedIds: string[]) => {
        actionCalled = true
        actionInstanceIds = [...lockedIds]
      }

      // act
      const [token, lockedStateIds] = await instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
      )

      // assert
      expect(actionCalled).toBe(true)
      expect(actionInstanceIds).toHaveLength(2)
      expect(actionInstanceIds).toEqual(expect.arrayContaining(stateIds))
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual(expect.arrayContaining(stateIds))

      // verify locks remain after completion
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(remainingLocks).toHaveLength(2)

      // clean up by unlocking
      await instanceLockService.unlockInstances(project.id, lockedStateIds, token)
    },
  )

  instanceLockTest(
    "handles empty instance list",
    async ({ instanceLockService, project, expect }) => {
      // arrange
      const stateIds: string[] = []
      const lockMeta: CommonObjectMeta = { title: "Empty Lock" }
      let actionCalled = false

      const action = async () => {
        actionCalled = true
      }

      // act
      const [token, lockedStateIds] = await instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
      )

      // assert
      expect(actionCalled).toBe(false)
      expect(token).toBe("")
      expect(lockedStateIds).toEqual([])
    },
  )

  instanceLockTest(
    "retries lock acquisition when instances are initially locked",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)

      const stateIds = [instance1.id, instance2.id]
      const lockMeta: CommonObjectMeta = { title: "Retry Test Lock" }
      let actionCalled = false
      let actionInstanceIds: string[] = []

      // create initial locks that will be released during the test
      await projectDatabase.instanceLock.createMany({
        data: stateIds.map(stateId => ({
          stateId,
          meta: { title: "Initial Lock" },
          token: "initial-token",
        })),
      })

      const action = async (_tx: ProjectTransaction, lockedIds: string[]) => {
        actionCalled = true
        actionInstanceIds = [...lockedIds]
      }

      // set up a delayed unlock to simulate async behavior
      const unlockPromise = new Promise<void>(resolve => {
        setTimeout(async () => {
          await instanceLockService.unlockInstancesUnconditionally(project.id, stateIds)
          resolve()
        }, 100)
      })

      // act
      const lockPromise = instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
        false, // allowPartialLock
        undefined, // abortSignal
        500, // eventWaitTime - short for faster tests
      )

      // wait for both operations to complete
      const [lockResult, _] = await Promise.all([lockPromise, unlockPromise])
      const [token, lockedStateIds] = lockResult

      // assert
      expect(actionCalled).toBe(true)
      expect(actionInstanceIds).toEqual(expect.arrayContaining(stateIds))
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual(expect.arrayContaining(stateIds))

      // verify locks remain after completion
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(remainingLocks).toHaveLength(2)

      // clean up by unlocking
      await instanceLockService.unlockInstances(project.id, lockedStateIds, token)

      // verify unlock events were published
      expect(pubsubManager.publish).toHaveBeenCalledWith(
        ["instance-lock", project.id],
        expect.objectContaining({
          type: "unlocked",
          stateIds: expect.arrayContaining(stateIds),
        }),
      )
    },
  )

  instanceLockTest(
    "handles partial locking with allowPartialLock enabled",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const instance3 = await createInstanceState(project.id)

      const stateIds = [instance1.id, instance2.id, instance3.id]
      const lockMeta: CommonObjectMeta = { title: "Partial Lock Test" }
      const actionCalls: string[][] = []

      // lock one instance initially
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Blocking Lock" },
          token: "blocking-token",
        },
      })

      const action = async (_tx: ProjectTransaction, lockedIds: string[]) => {
        actionCalls.push([...lockedIds])
      }

      // set up delayed unlock of the blocking instance
      const unlockPromise = new Promise<void>(resolve => {
        setTimeout(async () => {
          await instanceLockService.unlockInstancesUnconditionally(project.id, [instance1.id])
          resolve()
        }, 150)
      })

      // act
      const lockPromise = instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
        true, // allowPartialLock
        undefined, // abortSignal
        300, // eventWaitTime - short for faster tests
      )

      const [lockResult, _] = await Promise.all([lockPromise, unlockPromise])
      const [token, lockedStateIds] = lockResult

      // assert
      expect(actionCalls).toHaveLength(2) // should be called twice due to partial locking

      // first call should have 2 instances (excluding the initially locked one)
      expect(actionCalls[0]).toHaveLength(2)
      expect(actionCalls[0]).toEqual(expect.arrayContaining([instance2.id, instance3.id]))

      // second call should have 1 instance (the previously locked one)
      expect(actionCalls[1]).toHaveLength(1)
      expect(actionCalls[1]).toEqual([instance1.id])

      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual(expect.arrayContaining(stateIds))

      // verify locks remain
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(remainingLocks).toHaveLength(3)

      // clean up by unlocking
      await instanceLockService.unlockInstances(project.id, lockedStateIds, token)
    },
  )

  instanceLockTest(
    "respects abort signal and cancels operation",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const stateIds = [instance.id]
      const lockMeta: CommonObjectMeta = { title: "Abort Test Lock" }
      let actionCalled = false

      // create a lock that won't be released
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance.id,
          meta: { title: "Permanent Lock" },
          token: "permanent-token",
        },
      })

      const action = async () => {
        actionCalled = true
      }

      const abortController = new AbortController()

      // abort after a short delay
      setTimeout(() => {
        abortController.abort()
      }, 50)

      // act & assert
      await expect(
        instanceLockService.lockInstances(
          project.id,
          stateIds,
          lockMeta,
          action,
          false,
          abortController.signal,
          200, // eventWaitTime - short for faster tests
        ),
      ).rejects.toThrow("Lock operation was aborted")

      expect(actionCalled).toBe(false)

      // verify the original lock still exists
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance.id },
      })
      expect(locks).toHaveLength(1)
      expect(locks[0].token).toBe("permanent-token")
    },
  )

  instanceLockTest(
    "handles concurrent unlock events properly",
    async ({
      instanceLockService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const instance3 = await createInstanceState(project.id)

      const targetInstanceIds = [instance1.id, instance2.id]
      const lockMeta: CommonObjectMeta = { title: "Concurrent Test Lock" }
      let actionCalled = false

      // lock target instances
      await projectDatabase.instanceLock.createMany({
        data: targetInstanceIds.map(stateId => ({
          stateId,
          meta: { title: "Target Lock" },
          token: "target-token",
        })),
      })

      const action = async (_tx: ProjectTransaction, lockedIds: string[]) => {
        actionCalled = true
        expect(lockedIds).toEqual(expect.arrayContaining(targetInstanceIds))
      }

      // set up multiple concurrent unlock operations
      const unlockPromises = [
        // unlock unrelated instance (should not affect our wait)
        new Promise<void>(resolve => {
          setTimeout(async () => {
            await instanceLockService.unlockInstancesUnconditionally(project.id, [instance3.id])
            resolve()
          }, 50)
        }),
        // unlock our target instances
        new Promise<void>(resolve => {
          setTimeout(async () => {
            await instanceLockService.unlockInstancesUnconditionally(project.id, targetInstanceIds)
            resolve()
          }, 100)
        }),
      ]

      // act
      const lockPromise = instanceLockService.lockInstances(
        project.id,
        targetInstanceIds,
        lockMeta,
        action,
        false, // allowPartialLock
        undefined, // abortSignal
        400, // eventWaitTime - short for faster tests
      )

      await Promise.all([lockPromise, ...unlockPromises])

      // assert
      expect(actionCalled).toBe(true)

      // verify proper events were published
      const publishCalls = pubsubManager.publish.mock.calls.filter(
        call => call[0][0] === "instance-lock" && call[0][1] === project.id,
      )

      // should have unlock events for both unrelated and target instances
      expect(publishCalls.length).toBeGreaterThanOrEqual(2)
    },
  )

  instanceLockTest(
    "handles simple partial lock with delayed unlock",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // simplified test - just verify partial locking works at all
      const instance1 = await createInstanceState(project.id)
      const instance2 = await createInstanceState(project.id)
      const stateIds = [instance1.id, instance2.id]
      const lockMeta: CommonObjectMeta = { title: "Simple Partial Test" }
      let actionCallCount = 0

      // lock one instance initially
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance1.id,
          meta: { title: "Initial Lock" },
          token: "initial-token",
        },
      })

      const action = async (_tx: ProjectTransaction, _lockedIds: string[]) => {
        actionCallCount++
      }

      // unlock after delay
      setTimeout(async () => {
        await instanceLockService.unlockInstancesUnconditionally(project.id, [instance1.id])
      }, 100)

      // act
      const [token, lockedStateIds] = await instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
        true, // allowPartialLock
        undefined, // abortSignal
        250, // eventWaitTime - short for faster tests
      )

      // assert - should be called exactly twice (once for instance2, once for instance1 after unlock)
      expect(actionCallCount).toBe(2)
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual(expect.arrayContaining(stateIds))

      // verify locks remain
      const remainingLocks = await projectDatabase.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
      })
      expect(remainingLocks).toHaveLength(2)

      // clean up by unlocking
      await instanceLockService.unlockInstances(project.id, lockedStateIds, token)
    },
    10000,
  )

  instanceLockTest(
    "retries after eventWaitTime when unlock event is not delivered",
    async ({ instanceLockService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const stateIds = [instance.id]
      const lockMeta: CommonObjectMeta = { title: "No Event Timeout Test" }
      let actionCalled = false

      // create a lock that will be removed directly from database (no event published)
      await projectDatabase.instanceLock.create({
        data: {
          stateId: instance.id,
          meta: { title: "Silent Lock" },
          token: "silent-token",
        },
      })

      const action = async () => {
        actionCalled = true
      }

      // remove lock directly from database after allowing time for first attempt
      // this simulates the situation where lock is released but event is not delivered
      setTimeout(async () => {
        await projectDatabase.instanceLock.deleteMany({
          where: { stateId: instance.id },
        })
        // note: no event is published here, so lockInstances must rely on timeout to retry
      }, 600) // delete after 600ms (allowing first attempt + first timeout cycle)

      const startTime = Date.now()

      // act - this should timeout after 300ms, retry, and succeed on second attempt
      const [token, lockedStateIds] = await instanceLockService.lockInstances(
        project.id,
        stateIds,
        lockMeta,
        action,
        false,
        undefined,
        300, // eventWaitTime - should timeout and retry when no event comes
      )

      const endTime = Date.now()
      const duration = endTime - startTime

      // assert
      expect(actionCalled).toBe(true) // action should eventually be called
      expect(duration).toBeGreaterThanOrEqual(600) // should wait at least until lock removal
      expect(duration).toBeLessThan(1200) // but complete reasonably quickly after timeout
      expect(token).toMatch(/^[0-9a-z]{24}$/)
      expect(lockedStateIds).toEqual([instance.id])

      // verify locks remain
      const locks = await projectDatabase.instanceLock.findMany({
        where: { stateId: instance.id },
      })
      expect(locks).toHaveLength(1)

      // clean up by unlocking
      await instanceLockService.unlockInstances(project.id, lockedStateIds, token)
    },
    5000, // 5 second timeout for this test
  )
})
