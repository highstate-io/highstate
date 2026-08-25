import type { PubSubManager } from "../pubsub"

export type PanelEndpoint = {
  authority: string
  panelName: string
  stateId: string
  workerInstanceId: string
}

type WorkerInstance = {
  authority: string
  panelIdsByState: Map<string, Set<string>>
  projectId: string
  workerVersionId: string
}

type ActivePanel = PanelEndpoint & {
  projectId: string
  workerVersionId: string
}

export class PanelEndpointManager {
  private readonly instances = new Map<string, WorkerInstance>()
  private readonly instanceIdsByVersion = new Map<string, string>()
  private readonly panels = new Map<string, ActivePanel>()

  constructor(private readonly pubsubManager?: PubSubManager) {}

  /**
   * Verifies that a concrete worker instance has an active data endpoint.
   *
   * @param projectId The ID of the project owning the worker.
   * @param workerVersionId The ID of the connected worker version.
   * @param workerInstanceId The ID of the concrete worker instance.
   */
  assertInstance(projectId: string, workerVersionId: string, workerInstanceId: string): void {
    const instance = this.instances.get(workerInstanceId)
    if (
      !instance ||
      instance.projectId !== projectId ||
      instance.workerVersionId !== workerVersionId
    ) {
      throw new Error(`Worker instance "${workerInstanceId}" is not connected for this worker`)
    }
  }

  /**
   * Registers the data endpoint of a concrete worker instance.
   *
   * Only one instance per worker version is supported until registration sharding is implemented.
   *
   * @param projectId The ID of the project owning the worker.
   * @param workerVersionId The ID of the connected worker version.
   * @param workerInstanceId The ID of the concrete worker instance.
   * @param dataEndpoint The host and port reachable by the frontend gateway.
   */
  connect(
    projectId: string,
    workerVersionId: string,
    workerInstanceId: string,
    dataEndpoint: string,
  ): void {
    const authority = parseAuthority(dataEndpoint)
    const activeInstanceId = this.instanceIdsByVersion.get(workerVersionId)
    if (activeInstanceId && activeInstanceId !== workerInstanceId) {
      throw new Error(`Worker version "${workerVersionId}" already has an active instance`)
    }

    if (this.instances.has(workerInstanceId)) {
      throw new Error(`Worker instance "${workerInstanceId}" is already connected`)
    }

    this.instances.set(workerInstanceId, {
      authority,
      panelIdsByState: new Map(),
      projectId,
      workerVersionId,
    })
    this.instanceIdsByVersion.set(workerVersionId, workerInstanceId)
  }

  /**
   * Removes a worker instance and all panel endpoints published by it.
   *
   * @param workerInstanceId The ID of the disconnected worker instance.
   */
  disconnect(workerInstanceId: string): void {
    const instance = this.instances.get(workerInstanceId)
    if (!instance) {
      return
    }

    this.instances.delete(workerInstanceId)
    if (this.instanceIdsByVersion.get(instance.workerVersionId) === workerInstanceId) {
      this.instanceIdsByVersion.delete(instance.workerVersionId)
    }
    for (const panelIds of instance.panelIdsByState.values()) {
      for (const panelId of panelIds) {
        if (this.panels.get(panelId)?.workerInstanceId !== workerInstanceId) {
          continue
        }

        this.panels.delete(panelId)
        this.publishAvailability(instance.projectId, panelId, false)
      }
    }
  }

  /**
   * Replaces the active panel endpoints published for a unit state.
   *
   * @param projectId The ID of the project owning the panels.
   * @param workerVersionId The ID of the worker version serving the panels.
   * @param workerInstanceId The ID of the concrete worker instance.
   * @param stateId The ID of the unit state owning the panels.
   * @param panels The stable panel IDs and names in registration order.
   */
  setPanels(
    projectId: string,
    workerVersionId: string,
    workerInstanceId: string,
    stateId: string,
    panels: Array<{ id: string; name: string }>,
  ): void {
    this.assertInstance(projectId, workerVersionId, workerInstanceId)
    const instance = this.instances.get(workerInstanceId)!

    const previousPanelIds = instance.panelIdsByState.get(stateId) ?? new Set()
    const nextPanelIds = new Set(panels.map(panel => panel.id))
    for (const panelId of previousPanelIds) {
      if (!nextPanelIds.has(panelId)) {
        this.panels.delete(panelId)
        this.publishAvailability(projectId, panelId, false)
      }
    }
    for (const panel of panels) {
      const existing = this.panels.get(panel.id)
      if (existing && existing.workerInstanceId !== workerInstanceId) {
        const previousInstance = this.instances.get(existing.workerInstanceId)
        const previousPanelIds = previousInstance?.panelIdsByState.get(existing.stateId)
        previousPanelIds?.delete(panel.id)
        if (previousPanelIds?.size === 0) {
          previousInstance?.panelIdsByState.delete(existing.stateId)
        }
      }

      this.panels.set(panel.id, {
        authority: instance.authority,
        panelName: panel.name,
        projectId,
        stateId,
        workerInstanceId,
        workerVersionId,
      })

      if (!previousPanelIds.has(panel.id)) {
        this.publishAvailability(projectId, panel.id, true)
      }
    }
    instance.panelIdsByState.set(stateId, nextPanelIds)
  }

  /**
   * Returns whether a panel currently has a connected worker data endpoint.
   *
   * @param projectId The ID of the project owning the panel.
   * @param workerVersionId The ID of the worker version serving the panel.
   * @param panelId The stable ID of the panel.
   */
  isPanelAvailable(projectId: string, workerVersionId: string, panelId: string): boolean {
    const panel = this.panels.get(panelId)
    return panel?.projectId === projectId && panel.workerVersionId === workerVersionId
  }

  /**
   * Resolves the live data endpoint for a panel.
   *
   * @param projectId The ID of the project owning the panel.
   * @param workerVersionId The ID of the worker version serving the panel.
   * @param panelId The stable ID of the panel.
   * @param workerInstanceId The optional instance to which a frontend session is pinned.
   * @returns The live endpoint, or `undefined` when the panel is offline.
   */
  getPanelEndpoint(
    projectId: string,
    workerVersionId: string,
    panelId: string,
    workerInstanceId?: string,
  ): PanelEndpoint | undefined {
    const panel = this.panels.get(panelId)
    if (
      panel?.projectId !== projectId ||
      panel.workerVersionId !== workerVersionId ||
      (workerInstanceId && panel.workerInstanceId !== workerInstanceId)
    ) {
      return undefined
    }

    return {
      authority: panel.authority,
      panelName: panel.panelName,
      stateId: panel.stateId,
      workerInstanceId: panel.workerInstanceId,
    }
  }

  private publishAvailability(projectId: string, panelId: string, online: boolean): void {
    void this.pubsubManager?.publish(["panel-availability", projectId, panelId], { online })
  }
}

function parseAuthority(value: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(`http://${value}`)
  } catch (error) {
    throw new Error(`Invalid worker data endpoint`, { cause: error })
  }
  if (endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search) {
    throw new Error(`Worker data endpoint must contain only a host and port`)
  }

  if (!endpoint.hostname || !endpoint.port) {
    throw new Error(`Worker data endpoint must include a host and port`)
  }

  return endpoint.host
}
