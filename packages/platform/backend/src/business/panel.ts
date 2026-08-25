import type { ProjectRequestContext } from "../common"
import type { DatabaseManager } from "../database"
import type { PanelEndpointManager } from "../panel"
import type { PubSubManager } from "../pubsub"
import type { PanelInput } from "../shared"
import { requireProjectPermission } from "../common"
import {
  DuplicatePanelNameError,
  InstanceStateNotFoundError,
  WorkerOwnershipError,
  WorkerRegistrationNotFoundError,
} from "../shared"

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
   * @param context The project request context.
   * @param stateId The ID of the instance state.
   * @param apiKeyId The ID of the API key used by the worker version.
   * @param workerVersionId The ID of the worker version serving the panels.
   * @param panels The complete set of panels currently served for the instance.
   * @param workerInstanceId The ID of the concrete worker instance serving the panels.
   * @returns The stable IDs of the reconciled panels.
   */
  async setUnitPanels(
    context: ProjectRequestContext,
    stateId: string,
    apiKeyId: string,
    workerVersionId: string,
    panels: PanelInput[],
    workerInstanceId: string,
  ): Promise<string[]> {
    this.panelEndpointManager.assertInstance(context.projectId, workerVersionId, workerInstanceId)

    const database = await this.database.forProject(context.projectId)
    const target = await database.instanceState.findUnique({
      where: { id: stateId },
      select: { instanceId: true },
    })

    if (!target) {
      throw new InstanceStateNotFoundError(context.projectId, stateId)
    }

    requireProjectPermission(context, "panel.update", {
      instanceId: target.instanceId,
      workerId: context.subject.type === "service-account" ? context.subject.workerId : undefined,
      ownerServiceAccountId:
        context.subject.type === "service-account" ? context.subject.serviceAccountId : undefined,
    })

    const names = panels.map(panel => panel.name)
    const duplicateIndex = names.findIndex((name, index) => names.indexOf(name) !== index)
    if (duplicateIndex !== -1) {
      throw new DuplicatePanelNameError(
        context.projectId,
        stateId,
        names[duplicateIndex]!,
        duplicateIndex,
      )
    }

    const panelIds = await database.$transaction(async tx => {
      const workerVersion = await tx.workerVersion.findFirst({
        where: { id: workerVersionId, apiKeyId },
        select: {
          worker: { select: { serviceAccountId: true } },
        },
      })

      if (!workerVersion) {
        throw new WorkerOwnershipError(context.projectId, workerVersionId)
      }

      const registration = await tx.workerUnitRegistration.findFirst({
        where: { stateId, workerVersionId },
        select: { stateId: true },
      })

      if (panels.length > 0 && !registration) {
        throw new WorkerRegistrationNotFoundError(context.projectId, stateId, workerVersionId)
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
    void this.pubsubManager.publish(["instance-state", context.projectId], {
      type: "patched",
      stateId,
      patch: { panelIds: statePanels.map(panel => panel.id) },
    })
    this.panelEndpointManager.setPanels(
      context.projectId,
      workerVersionId,
      workerInstanceId,
      stateId,
      panelIds.map((id, index) => ({ id, name: panels[index]!.name })),
    )

    return panelIds
  }
}
