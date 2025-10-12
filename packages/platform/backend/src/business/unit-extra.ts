import type { UnitPage, UnitTerminal, UnitTrigger } from "@highstate/contract"
import type { DatabaseManager, ProjectTransaction } from "../database"

export class UnitExtraService {
  constructor(private readonly database: DatabaseManager) {}

  /**
   * Processes unit terminals within an existing transaction.
   *
   * @param tx The database transaction to use.
   * @param stateId The ID of the instance state.
   * @param unitTerminals The unit terminals to process.
   * @returns Array of terminal IDs that are active for this instance.
   */
  async processUnitTerminals(
    tx: ProjectTransaction,
    stateId: string,
    unitTerminals: UnitTerminal[],
  ): Promise<string[]> {
    const terminalIds: string[] = []

    // upsert terminals
    for (const unit of unitTerminals) {
      const terminal = await tx.terminal.upsert({
        where: { stateId_name: { stateId, name: unit.name } },
        create: {
          stateId,
          name: unit.name,
          meta: unit.meta ?? {},
          spec: unit.spec,
          status: "active",
        },
        update: {
          meta: unit.meta ?? {},
          spec: unit.spec,
          status: "active",
        },
        select: { id: true },
      })
      terminalIds.push(terminal.id)
    }

    // mark dangling terminals as unavailable
    const unitNames = unitTerminals.map(u => u.name)
    await tx.terminal.updateMany({
      where: {
        stateId,
        name: { notIn: unitNames },
        status: "active",
      },
      data: { status: "unavailable" },
    })

    return terminalIds
  }

  /**
   * Processes unit pages within an existing transaction.
   *
   * @param tx The database transaction to use.
   * @param stateId The ID of the instance state.
   * @param unitPages The unit pages to process.
   * @returns Array of page IDs that exist for this instance.
   */
  async processUnitPages(
    tx: ProjectTransaction,
    stateId: string,
    unitPages: UnitPage[],
  ): Promise<string[]> {
    const pageIds: string[] = []

    // upsert pages
    for (const unit of unitPages) {
      const page = await tx.page.upsert({
        where: { stateId_name: { stateId, name: unit.name } },
        create: {
          stateId,
          name: unit.name,
          meta: unit.meta ?? {},
          content: unit.content,
        },
        update: {
          meta: unit.meta ?? {},
          content: unit.content,
        },
        select: { id: true },
      })
      pageIds.push(page.id)
    }

    // delete dangling pages
    const unitNames = unitPages.map(u => u.name)
    await tx.page.deleteMany({
      where: {
        stateId,
        name: { notIn: unitNames },
      },
    })

    return pageIds
  }

  /**
   * Processes unit triggers within an existing transaction.
   *
   * @param tx The database transaction to use.
   * @param stateId The ID of the instance state.
   * @param unitTriggers The unit triggers to process.
   * @returns Array of trigger IDs that exist for this instance.
   */
  async processUnitTriggers(
    tx: ProjectTransaction,
    stateId: string,
    unitTriggers: UnitTrigger[],
  ): Promise<string[]> {
    const triggerIds: string[] = []

    // upsert triggers
    for (const unit of unitTriggers) {
      const trigger = await tx.trigger.upsert({
        where: { stateId_name: { stateId, name: unit.name } },
        create: {
          stateId,
          name: unit.name,
          meta: unit.meta ?? {},
          spec: unit.spec,
        },
        update: {
          meta: unit.meta ?? {},
          spec: unit.spec,
        },
        select: { id: true },
      })
      triggerIds.push(trigger.id)
    }

    // delete dangling triggers
    const unitNames = unitTriggers.map(u => u.name)
    await tx.trigger.deleteMany({
      where: {
        stateId,
        name: { notIn: unitNames },
      },
    })

    return triggerIds
  }

  /**
   * Disconnects artifacts that are no longer referenced by the instance.
   *
   * @param tx The database transaction to use.
   * @param stateId The ID of the instance state.
   * @param artifactIds The artifact IDs that should remain connected to the instance.
   */
  async pruneInstanceArtifacts(
    tx: ProjectTransaction,
    stateId: string,
    artifactIds: string[],
  ): Promise<void> {
    const staleArtifacts = await tx.artifact.findMany({
      where: {
        instances: {
          some: {
            id: stateId,
          },
        },
        id: artifactIds.length > 0 ? { notIn: artifactIds } : undefined,
      },
      select: {
        id: true,
      },
    })

    if (staleArtifacts.length === 0) {
      return
    }

    await tx.instanceState.update({
      where: { id: stateId },
      data: {
        artifacts: {
          disconnect: staleArtifacts.map(artifact => ({ id: artifact.id })),
        },
      },
    })
  }

  /**
   * Gets all triggers for a specific instance.
   *
   * @param projectId The project ID.
   * @param stateId The ID of the instance state to get triggers for.
   */
  async getInstanceTriggers(projectId: string, stateId: string) {
    const database = await this.database.forProject(projectId)

    return database.trigger.findMany({ where: { stateId } })
  }
}
