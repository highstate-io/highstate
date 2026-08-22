import type { DatabaseManager } from "../database"
import type { PanelEndpointManager } from "../panel"
import type { PubSubManager } from "../pubsub"
import type { PanelInput } from "../shared"
import { AccessError } from "../shared"

export class PanelService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly panelEndpointManager: PanelEndpointManager,
  ) {}

  /**
   * Replaces all panels served by a worker version for a unit instance.
   *
   * The API key must belong to the worker version and that version must have an active
   * registration for the instance.
   *
   * @param projectId The ID of the project.
   * @param stateId The ID of the instance state.
   * @param apiKeyId The ID of the API key used by the worker version.
   * @param workerVersionId The ID of the worker version serving the panels.
   * @param panels The complete set of panels currently served for the instance.
   * @param workerInstanceId The ID of the concrete worker instance serving the panels.
   * @returns The stable IDs of the reconciled panels.
   */
  async setUnitPanels(
    projectId: string,
    stateId: string,
    apiKeyId: string,
    workerVersionId: string,
    panels: PanelInput[],
    workerInstanceId: string,
  ): Promise<string[]> {
    this.panelEndpointManager.assertInstance(projectId, workerVersionId, workerInstanceId)

    const database = await this.database.forProject(projectId)
    const names = panels.map(panel => panel.name)
    if (new Set(names).size !== names.length) {
      throw new AccessError(`Panel names must be unique within an instance registration.`)
    }

    const panelIds = await database.$transaction(async tx => {
      const workerVersion = await tx.workerVersion.findFirst({
        where: { id: workerVersionId, apiKeyId },
        select: {
          worker: { select: { serviceAccountId: true } },
        },
      })
      if (!workerVersion) {
        throw new AccessError(`Worker version "${workerVersionId}" is not owned by the API key.`)
      }

      const registration = await tx.workerUnitRegistration.findFirst({
        where: { stateId, workerVersionId },
        select: { stateId: true },
      })
      if (panels.length > 0 && !registration) {
        throw new AccessError(
          `Worker version "${workerVersionId}" is not registered for state "${stateId}".`,
        )
      }

      const serviceAccountId = workerVersion.worker.serviceAccountId
      const ids: string[] = []

      for (const panel of panels) {
        const record = await tx.panel.upsert({
          where: {
            stateId_serviceAccountId_name: {
              stateId,
              serviceAccountId,
              name: panel.name,
            },
          },
          create: {
            stateId,
            serviceAccountId,
            workerVersionId,
            name: panel.name,
            meta: panel.meta,
          },
          update: {
            workerVersionId,
            meta: panel.meta,
          },
          select: { id: true },
        })
        ids.push(record.id)
      }

      await tx.panel.deleteMany({
        where: {
          stateId,
          serviceAccountId,
          workerVersionId,
          name: { notIn: names },
        },
      })

      return ids
    })

    const statePanels = await database.panel.findMany({
      where: { stateId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    void this.pubsubManager.publish(["instance-state", projectId], {
      type: "patched",
      stateId,
      patch: { panelIds: statePanels.map(panel => panel.id) },
    })
    this.panelEndpointManager.setPanels(
      projectId,
      workerVersionId,
      workerInstanceId,
      stateId,
      panelIds.map((id, index) => ({ id, name: panels[index]!.name })),
    )

    return panelIds
  }
}
