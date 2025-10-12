import type { CommonObjectMeta } from "@highstate/contract"
import type { Logger } from "pino"
import type { DatabaseManager, InstanceLock, ProjectTransaction } from "../database"
import type { PubSubManager } from "../pubsub"
import { createId } from "@paralleldrive/cuid2"
import { type InstanceLockEvent, InstanceLockLostError } from "../shared"

/**
 * Service for managing instance locks within projects.
 * Handles atomic lock operations using database transactions.
 */
export class InstanceLockService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Attempts to acquire locks on the specified instances.
   * Uses database transactions to ensure atomicity.
   *
   * @param projectId The project ID containing the instances.
   * @param stateIds The instance state IDs to lock.
   * @param lockMeta The metadata for the locks.
   * @param action Optional async action to execute once locks are acquired in the same transaction with the locks.
   * @param allowPartialLock Whether to allow partial locking when some instances are already locked.
   * @param customToken Optional custom token to use instead of auto-generating one.
   * @returns A tuple containing the token and array of successfully locked state IDs.
   */
  async tryLockInstances(
    projectId: string,
    stateIds: string[],
    lockMeta: CommonObjectMeta,
    action?: (tx: ProjectTransaction, stateIds: string[]) => Promise<void>,
    allowPartialLock = false,
    customToken?: string,
  ): Promise<[token: string, lockedStateIds: string[]]> {
    if (stateIds.length === 0) {
      return ["", []]
    }

    // use custom token or generate a cuid token for this lock operation
    const token = customToken ?? createId()
    const database = await this.database.forProject(projectId)

    return await database.$transaction(async tx => {
      // check for existing locks on requested instances
      const existingLocks = await tx.instanceLock.findMany({
        where: { stateId: { in: stateIds } },
        select: { stateId: true },
      })

      const lockedStateIds = existingLocks.map(lock => lock.stateId)
      const availableStateIds = stateIds.filter(id => !lockedStateIds.includes(id))

      if (lockedStateIds.length > 0) {
        this.logger.debug(
          {
            projectId,
            conflictingInstances: lockedStateIds.length,
            totalRequested: stateIds.length,
          },
          "found %s conflicting locks when attempting to lock %s instances",
          lockedStateIds.length,
          stateIds.length,
        )

        if (!allowPartialLock) {
          return ["", []]
        }
      }

      if (availableStateIds.length === 0) {
        // when custom token is provided and no instances are locked, don't return the token
        // when allowPartialLock is true and no custom token, return a token for consistency
        return [allowPartialLock && !customToken ? token : "", []]
      }

      // create locks for available instances with the generated token
      const lockData: InstanceLock[] = availableStateIds.map(stateId => ({
        stateId,
        meta: lockMeta,
        token,
        acquiredAt: new Date(),
      }))

      await tx.instanceLock.createMany({ data: lockData })

      await action?.(tx, availableStateIds)

      this.logger.debug(
        { projectId, lockedCount: availableStateIds.length, token },
        "locked %s instances",
        availableStateIds.length,
      )

      // publish lock event
      await this.pubsubManager.publish(["instance-lock", projectId], {
        type: "locked",
        locks: lockData,
      })

      return [token, availableStateIds]
    })
  }

  /**
   * Checks if an instance is currently locked.
   *
   * @param projectId The project ID containing the instance.
   * @param stateId The instance state ID to check.
   * @returns True if the instance is locked, false otherwise.
   */
  async isInstanceLocked(projectId: string, stateId: string): Promise<boolean> {
    const database = await this.database.forProject(projectId)

    const lock = await database.instanceLock.findUnique({
      where: { stateId },
    })

    return lock !== null
  }

  /**
   * Removes locks from the specified instances using the provided token.
   * Executes an optional unlock action within the transaction if the lock is still valid.
   *
   * @param projectId The project ID containing the instances.
   * @param stateIds The instance state IDs to unlock.
   * @param token The token that was returned when the locks were created.
   * @param unlockAction Optional async action to execute within the unlock transaction if the lock is still valid.
   * @throws {InstanceLockLostError} When the lock with the given token is not found.
   */
  async unlockInstances(
    projectId: string,
    stateIds: string[],
    token: string,
    unlockAction?: (tx: ProjectTransaction) => Promise<void>,
  ): Promise<void> {
    if (stateIds.length === 0) {
      return
    }

    if (!token) {
      throw new Error("Token is required to unlock instances")
    }

    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      // verify that locks with the given token exist for all requested instances
      const existingLocks = await tx.instanceLock.findMany({
        where: {
          stateId: { in: stateIds },
          token: token,
        },
        select: { stateId: true },
      })

      const lockedStateIds = existingLocks.map(lock => lock.stateId)
      const missingLocks = stateIds.filter(id => !lockedStateIds.includes(id))

      if (missingLocks.length > 0) {
        throw new InstanceLockLostError(projectId, missingLocks, token)
      }

      // execute the optional unlock action if provided
      if (unlockAction) {
        await unlockAction(tx)
      }

      // remove the locks
      const { count } = await tx.instanceLock.deleteMany({
        where: {
          stateId: { in: stateIds },
          token: token,
        },
      })

      if (count > 0) {
        this.logger.debug(
          { projectId, unlockedCount: count, token },
          "unlocked %s instances",
          count,
        )

        // publish unlock event
        await this.pubsubManager.publish(["instance-lock", projectId], {
          type: "unlocked",
          stateIds: lockedStateIds,
        })
      }
    })
  }

  /**
   * Unconditionally removes locks from the specified instances.
   * This will remove locks regardless of their current state or ownership.
   *
   * @param projectId The project ID containing the instances.
   * @param stateIds The instance state IDs to unlock.
   */
  async unlockInstancesUnconditionally(projectId: string, stateIds: string[]): Promise<void> {
    if (stateIds.length === 0) {
      return
    }

    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      const { count } = await tx.instanceLock.deleteMany({
        where: { stateId: { in: stateIds } },
      })

      if (count > 0) {
        this.logger.info({ projectId, unlockedCount: count }, "unlocked %s instances", count)

        // publish unlock event
        await this.pubsubManager.publish(["instance-lock", projectId], {
          type: "unlocked",
          stateIds,
        })
      }
    })
  }

  /**
   * Attempts to acquire locks on the specified instances with retry logic.
   * Subscribes to unlock events and retries lock acquisition until successful or aborted.
   *
   * @param projectId The project ID containing the instances.
   * @param stateIds The instance state IDs to lock.
   * @param lockMeta The metadata for the locks.
   * @param action Optional async action to execute when instances are locked.
   * @param allowPartialLock Whether to allow partial locking when some instances are already locked.
   * @param abortSignal Optional abort signal to interrupt lock operations.
   * @param eventWaitTime Optional time in milliseconds to wait for unlock events before retrying (default: 60000ms).
   * @param customToken Optional custom token to use instead of auto-generating one.
   * @returns A tuple containing the token and array of successfully locked state IDs.
   */
  async lockInstances(
    projectId: string,
    stateIds: string[],
    lockMeta: CommonObjectMeta,
    action?: (tx: ProjectTransaction, stateIds: string[]) => Promise<void>,
    allowPartialLock = false,
    abortSignal?: AbortSignal,
    eventWaitTime = 60000,
    customToken?: string,
  ): Promise<[token: string, lockedStateIds: string[]]> {
    if (stateIds.length === 0) {
      return ["", []]
    }

    // generate a single token for all locks
    const token = customToken ?? createId()

    // track which instances still need to be locked
    let remainingStateIds = [...stateIds]
    const lockedStateIds: string[] = []

    // create abort controller for managing event subscription
    const subscriptionController = new AbortController()

    // set up event subscription first before attempting any locks to reduce probability of missing events
    const eventIterable = await this.pubsubManager.subscribe(
      ["instance-lock", projectId],
      subscriptionController.signal,
    )

    try {
      while (remainingStateIds.length > 0) {
        if (abortSignal?.aborted) {
          throw new Error("Lock operation was aborted")
        }

        this.logger.debug(
          {
            projectId,
            remainingCount: remainingStateIds.length,
            lockedCount: lockedStateIds.length,
          },
          "attempting to lock %s remaining instances",
          remainingStateIds.length,
        )

        // try to acquire locks on remaining instances using the same token
        const [_, newlyLockedStateIds] = await this.tryLockInstances(
          projectId,
          remainingStateIds,
          lockMeta,
          action,
          allowPartialLock,
          token,
        )

        if (newlyLockedStateIds.length === 0) {
          // no instances were locked, wait for unlock events
          this.logger.debug(
            { projectId, remainingCount: remainingStateIds.length },
            "waiting for unlock events for %s remaining instances",
            remainingStateIds.length,
          )

          await this.waitForUnlockEvent(
            projectId,
            remainingStateIds,
            eventIterable,
            abortSignal,
            eventWaitTime,
          )
          continue
        }

        // remove newly locked instances from remaining list
        remainingStateIds = remainingStateIds.filter(id => !newlyLockedStateIds.includes(id))
        lockedStateIds.push(...newlyLockedStateIds)

        // if partial locking is not allowed, we should have all instances by now
        if (!allowPartialLock && remainingStateIds.length > 0) {
          this.logger.error(
            { projectId, remaining: remainingStateIds.length },
            "partial lock not allowed but %s instances remain unlocked",
            remainingStateIds.length,
          )
          throw new Error("Failed to acquire all required locks")
        }
      }

      return [token, lockedStateIds]
    } finally {
      // clean up event subscription
      subscriptionController.abort()
    }
  }

  /**
   * Waits for an unlock event that affects any of the specified state IDs,
   * or times out to trigger the next retry attempt.
   *
   * @param projectId The project ID to monitor for events.
   * @param stateIds The state IDs we're waiting to become available.
   * @param eventIterable The async iterable for event subscription.
   * @param abortSignal Optional abort signal to interrupt waiting.
   * @param eventWaitTime Time in milliseconds to wait before timing out and retrying.
   */
  private async waitForUnlockEvent(
    projectId: string,
    stateIds: string[],
    eventIterable: AsyncIterable<InstanceLockEvent>,
    abortSignal?: AbortSignal,
    eventWaitTime = 60000,
  ): Promise<void> {
    const eventController = new AbortController()

    // combine abort signals
    if (abortSignal?.aborted) {
      throw new Error("Lock operation was aborted")
    }

    const abortHandler = () => eventController.abort()
    abortSignal?.addEventListener("abort", abortHandler)

    try {
      await Promise.race([
        // timeout promise - triggers retry attempt, does not abort
        new Promise<void>(resolve => {
          setTimeout(() => {
            this.logger.debug(
              { projectId, eventWaitTime },
              "unlock wait timed out after %s ms, will retry",
              eventWaitTime,
            )
            resolve()
          }, eventWaitTime)
        }),

        // event listener promise
        this.listenForUnlockEvents(projectId, stateIds, eventIterable, eventController.signal),

        // abort promise - only this can interrupt the operation
        new Promise<void>((_, reject) => {
          if (abortSignal) {
            abortSignal.addEventListener("abort", () => {
              reject(new Error("Lock operation was aborted"))
            })
          }
        }),
      ])
    } finally {
      eventController.abort()
      abortSignal?.removeEventListener("abort", abortHandler)
    }
  }

  /**
   * Listens for unlock events using async iteration.
   *
   * @param projectId The project ID to monitor for events.
   * @param stateIds The state IDs we're waiting to become available.
   * @param eventIterable The async iterable for event subscription.
   * @param signal Abort signal to stop listening.
   */
  private async listenForUnlockEvents(
    projectId: string,
    stateIds: string[],
    eventIterable: AsyncIterable<InstanceLockEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const event of eventIterable) {
      if (signal.aborted) {
        break
      }
      if (event.type !== "unlocked") {
        continue // only interested in unlock events
      }

      const relevantUnlocks = event.stateIds.filter((id: string) => stateIds.includes(id))
      if (relevantUnlocks.length === 0) {
        continue // keep waiting for relevant unlocks
      }

      if (relevantUnlocks.length > 0) {
        this.logger.debug(
          { projectId, relevantUnlocks: relevantUnlocks.length },
          "found relevant unlock event for %s instances",
          relevantUnlocks.length,
        )
        return // this will resolve the promise and clean up the subscription
      }
    }
  }
}
