import type { CommonObjectMeta, UnitWorker } from "@highstate/contract"
import type { Logger } from "pino"
import type {
  DatabaseManager,
  ProjectTransaction,
  Worker,
  WorkerVersion,
  WorkerVersionLog,
} from "../database"
import type { PubSubManager } from "../pubsub"
import type { WorkerManager } from "../worker"
import { randomBytes } from "node:crypto"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client"
import { createProjectLogger } from "../common"
import {
  extractDigestFromImage,
  getWorkerIdentity,
  type WorkerUnitRegistrationEvent,
} from "../shared"
import { WorkerVersionNotFoundError } from "../shared/models/errors"

export class WorkerService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly workerManager: WorkerManager,
    private readonly pubsubManager: PubSubManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Updates unit worker registrations for an instance in a single transaction
   * creates workers and worker versions as needed and cleans up removed registrations
   *
   * @param tx The transaction to use for database operations.
   * @param projectId The ID of the project containing the instance.
   * @param stateId The ID of the instance state to update registrations for.
   * @param unitWorkers The list workers provided by the unit.
   */
  async updateUnitRegistrations(
    tx: ProjectTransaction,
    projectId: string,
    stateId: string,
    unitWorkers: UnitWorker[],
  ): Promise<void> {
    // parse images first
    const parsedWorkers = unitWorkers.map(w => {
      const digest = extractDigestFromImage(w.image)
      const identity = getWorkerIdentity(w.image)

      return { ...w, digest, identity }
    })

    const logger = createProjectLogger(this.logger, projectId)

    const eventsToPublish: { workerVersionId: string; event: WorkerUnitRegistrationEvent }[] = []

    // query all registrations for the instance
    const existingRegistrations = await tx.workerUnitRegistration.findMany({
      where: { stateId },
      select: { stateId: true, name: true, params: true, workerVersionId: true },
    })

    // the set of names we want to keep
    const desiredNames = new Set(parsedWorkers.map(w => w.name))

    for (const worker of parsedWorkers) {
      const workerRecord = await this.ensureWorker(tx, worker.identity)
      const workerVersionRecord = await this.ensureWorkerVersion(tx, workerRecord, worker.digest)

      const existing = existingRegistrations.find(r => r.name === worker.name)
      const stringifiedParams = JSON.stringify(worker.params)

      // create a new registration if it doesn't exist
      if (!existing) {
        await tx.workerUnitRegistration.create({
          data: {
            stateId,
            name: worker.name,
            params: worker.params,
            workerVersionId: workerVersionRecord.id,
          },
        })

        eventsToPublish.push({
          workerVersionId: workerVersionRecord.id,
          event: { type: "registered", instanceId: stateId, params: worker.params },
        })

        continue
      }

      const paramsChanged = JSON.stringify(existing.params) !== stringifiedParams
      const versionChanged = existing.workerVersionId !== workerVersionRecord.id

      // update existing registration if params or version changed
      if (paramsChanged || versionChanged) {
        await tx.workerUnitRegistration.update({
          where: { stateId_name: { stateId, name: worker.name } },
          data: {
            params: worker.params,
            workerVersionId: workerVersionRecord.id,
          },
        })

        // deregister from old worker version if it changed
        if (versionChanged) {
          eventsToPublish.push({
            workerVersionId: existing.workerVersionId,
            event: { type: "deregistered", instanceId: stateId },
          })
        }

        eventsToPublish.push({
          workerVersionId: workerVersionRecord.id,
          event: { type: "registered", instanceId: stateId, params: worker.params },
        })
      }
    }

    // remove registrations that are no longer desired
    for (const registration of existingRegistrations) {
      if (!desiredNames.has(registration.name)) {
        await tx.workerUnitRegistration.delete({
          where: { stateId_name: { stateId, name: registration.name } },
        })

        eventsToPublish.push({
          workerVersionId: registration.workerVersionId,
          event: { type: "deregistered", instanceId: stateId },
        })
      }
    }

    await this.cleanupUnusedWorkerVersions(tx)

    // publish events after transaction commits
    for (const { workerVersionId, event } of eventsToPublish) {
      void this.pubsubManager.publish(
        ["worker-unit-registration", projectId, workerVersionId],
        event,
      )
    }

    // ensure all worker versions are started
    void this.workerManager.syncWorkers(projectId)

    logger.info(`updated worker registrations for instance state "%s"`, stateId)
  }

  private async ensureWorker(tx: ProjectTransaction, identity: string): Promise<Worker> {
    const existing = await tx.worker.findUnique({ where: { identity } })
    if (existing) {
      return existing
    }

    // create a new service account for the worker
    const serviceAccount = await tx.serviceAccount.create({
      select: { id: true },
      data: {
        meta: {
          // this generic meta should be replaced by the worker when it starts
          title: "Worker Service Account",
          description: `Automatically created for worker "${identity}".`,
        },
      },
    })

    return await tx.worker.create({
      data: {
        identity,
        serviceAccountId: serviceAccount.id,
      },
    })
  }

  private async ensureWorkerVersion(
    tx: ProjectTransaction,
    worker: Worker,
    digest: string,
  ): Promise<WorkerVersion> {
    const existing = await tx.workerVersion.findUnique({ where: { digest } })
    if (existing) {
      return existing
    }

    // create an API key for the worker granting full access to its service account
    const apiKey = await tx.apiKey.create({
      data: {
        meta: {
          title: `Worker API Key for "${worker.identity}"`,
          description: `Automatically created for worker "${worker.identity}" with digest "${digest}".`,
        },
        serviceAccountId: worker.serviceAccountId,
        token: randomBytes(32).toString("hex"),
      },
    })

    return await tx.workerVersion.create({
      data: {
        workerId: worker.id,
        digest,
        meta: {
          title: "Worker Version",
          description: `Worker version with digest ${digest}`,
        },
        apiKeyId: apiKey.id,
      },
    })
  }

  /**
   * Performs cleanup of unused worker versions and syncs workers for a project.
   * This method should be called after operations that may leave unused workers.
   *
   * @param projectId The ID of the project to cleanup and sync workers for.
   */
  async cleanupWorkerUsageAndSync(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      await this.cleanupUnusedWorkerVersions(tx)
    })

    // ensure all worker versions are started
    void this.workerManager.syncWorkers(projectId)
  }

  private async cleanupUnusedWorkerVersions(tx: ProjectTransaction): Promise<void> {
    const unused = await tx.workerVersion.findMany({
      where: {
        unitRegistrations: { none: {} },
      },
      select: { id: true },
    })

    if (unused.length === 0) {
      return
    }

    await tx.workerVersion.deleteMany({
      where: { id: { in: unused.map(u => u.id) } },
    })
  }

  /**
   * Updates the metadata for a worker version.
   *
   * @param projectId The ID of the project.
   * @param workerVersionId The ID of the worker version to update.
   * @param meta The new metadata to set.
   */
  async updateWorkerVersionMeta(
    projectId: string,
    workerVersionId: string,
    meta: CommonObjectMeta,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)
    const logger = createProjectLogger(this.logger, projectId)

    try {
      await database.workerVersion.update({
        where: { id: workerVersionId },
        data: { meta },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
        throw new WorkerVersionNotFoundError(projectId, workerVersionId)
      }

      throw error
    }

    logger.info(`updated worker version metadata for "%s"`, workerVersionId)
  }

  /**
   * Gets logs for a worker version.
   *
   * @param projectId The ID of the project.
   * @param workerVersionId The ID of the worker version to get logs for.
   */
  async getWorkerVersionLogs(
    projectId: string,
    workerVersionId: string,
  ): Promise<WorkerVersionLog[]> {
    const database = await this.database.forProject(projectId)

    return await database.workerVersionLog.findMany({
      where: {
        workerVersionId,
      },
      orderBy: {
        id: "asc",
      },
    })
  }
}
