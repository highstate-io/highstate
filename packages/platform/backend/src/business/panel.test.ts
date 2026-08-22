import type { Worker, WorkerVersion } from "../database"
import type { PanelEndpointManager } from "../panel"
import { createId } from "@paralleldrive/cuid2"
import { describe, vi } from "vitest"
import { MemoryPubSubBackend, PubSubManager } from "../pubsub"
import { AccessError } from "../shared"
import { test } from "../test-utils"
import { PanelService } from "./panel"

const panelTest = test.extend<{
  panelService: PanelService
  panelEndpointManager: PanelEndpointManager
  createWorker(): Promise<Worker>
  createWorkerVersion(worker: Worker): Promise<WorkerVersion>
}>({
  panelService: async ({ database, logger, panelEndpointManager }, use) => {
    const pubsubManager = new PubSubManager(
      new MemoryPubSubBackend(logger),
      logger.child({ service: "PubSubManager" }),
    )
    const panelService = new PanelService(database, pubsubManager, panelEndpointManager)

    await use(panelService)
  },

  panelEndpointManager: async ({}, use) => {
    await use(
      vi.mockObject({
        assertInstance: vi.fn(),
        setPanels: vi.fn(),
      } as unknown as PanelEndpointManager),
    )
  },

  createWorker: async ({ projectDatabase }, use) => {
    const createWorker = async () => {
      return await projectDatabase.worker.create({
        data: {
          identity: `ghcr.io/highstate/${createId()}`,
          serviceAccount: {
            create: { meta: { title: "Test panel worker" } },
          },
        },
      })
    }

    await use(createWorker)
  },

  createWorkerVersion: async ({ projectDatabase }, use) => {
    const createWorkerVersion = async (worker: Worker) => {
      return await projectDatabase.workerVersion.create({
        data: {
          worker: { connect: worker },
          digest: createId(),
          meta: { title: "Test panel worker version" },
          apiKey: {
            create: {
              meta: { title: "Test panel worker API key" },
              serviceAccountId: worker.serviceAccountId,
              token: createId(),
            },
          },
        },
      })
    }

    await use(createWorkerVersion)
  },
})

describe("setUnitPanels", () => {
  panelTest(
    "creates, updates, and removes panels while preserving stable IDs",
    async ({
      panelService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      const state = await createInstanceState(project.id)
      const worker = await createWorker()
      const workerVersion = await createWorkerVersion(worker)
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: state.id,
          name: "panels",
          params: {},
          workerVersionId: workerVersion.id,
        },
      })

      const firstIds = await panelService.setUnitPanels(
        project.id,
        state.id,
        workerVersion.apiKeyId,
        workerVersion.id,
        [
          { name: "dashboard", meta: { title: "Dashboard" } },
          { name: "metrics", meta: { title: "Metrics" } },
        ],
        createId(),
      )
      const secondIds = await panelService.setUnitPanels(
        project.id,
        state.id,
        workerVersion.apiKeyId,
        workerVersion.id,
        [{ name: "dashboard", meta: { title: "Cluster dashboard" } }],
        createId(),
      )

      expect(secondIds).toEqual([firstIds[0]])
      await expect(
        projectDatabase.panel.findMany({ where: { stateId: state.id } }),
      ).resolves.toMatchObject([
        {
          id: firstIds[0],
          name: "dashboard",
          meta: { title: "Cluster dashboard" },
          serviceAccountId: worker.serviceAccountId,
          workerVersionId: workerVersion.id,
        },
      ])
    },
  )

  panelTest(
    "rejects a worker without a matching unit registration",
    async ({
      panelService,
      project,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      const state = await createInstanceState(project.id)
      const worker = await createWorker()
      const workerVersion = await createWorkerVersion(worker)

      await expect(
        panelService.setUnitPanels(
          project.id,
          state.id,
          workerVersion.apiKeyId,
          workerVersion.id,
          [{ name: "dashboard", meta: { title: "Dashboard" } }],
          createId(),
        ),
      ).rejects.toBeInstanceOf(AccessError)
    },
  )

  panelTest(
    "rejects an API key owned by another worker version",
    async ({
      panelService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      const state = await createInstanceState(project.id)
      const worker = await createWorker()
      const workerVersion = await createWorkerVersion(worker)
      const otherWorker = await createWorker()
      const otherWorkerVersion = await createWorkerVersion(otherWorker)
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: state.id,
          name: "panels",
          params: {},
          workerVersionId: workerVersion.id,
        },
      })

      await expect(
        panelService.setUnitPanels(
          project.id,
          state.id,
          otherWorkerVersion.apiKeyId,
          workerVersion.id,
          [{ name: "dashboard", meta: { title: "Dashboard" } }],
          createId(),
        ),
      ).rejects.toBeInstanceOf(AccessError)
    },
  )

  panelTest(
    "removes owned panels after the unit registration is deleted",
    async ({
      panelService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      const state = await createInstanceState(project.id)
      const worker = await createWorker()
      const workerVersion = await createWorkerVersion(worker)
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: state.id,
          name: "panels",
          params: {},
          workerVersionId: workerVersion.id,
        },
      })
      await panelService.setUnitPanels(
        project.id,
        state.id,
        workerVersion.apiKeyId,
        workerVersion.id,
        [{ name: "dashboard", meta: { title: "Dashboard" } }],
        createId(),
      )
      await projectDatabase.workerUnitRegistration.delete({
        where: { stateId_name: { stateId: state.id, name: "panels" } },
      })

      await panelService.setUnitPanels(
        project.id,
        state.id,
        workerVersion.apiKeyId,
        workerVersion.id,
        [],
        createId(),
      )

      await expect(
        projectDatabase.panel.findMany({ where: { stateId: state.id } }),
      ).resolves.toEqual([])
    },
  )

  panelTest(
    "does not remove a panel transferred to a newer worker version",
    async ({
      panelService,
      project,
      projectDatabase,
      createInstanceState,
      createWorker,
      createWorkerVersion,
      expect,
    }) => {
      const state = await createInstanceState(project.id)
      const worker = await createWorker()
      const oldVersion = await createWorkerVersion(worker)
      const newVersion = await createWorkerVersion(worker)
      await projectDatabase.workerUnitRegistration.create({
        data: {
          stateId: state.id,
          name: "panels",
          params: {},
          workerVersionId: oldVersion.id,
        },
      })
      const [panelId] = await panelService.setUnitPanels(
        project.id,
        state.id,
        oldVersion.apiKeyId,
        oldVersion.id,
        [{ name: "dashboard", meta: { title: "Dashboard" } }],
        createId(),
      )
      await projectDatabase.workerUnitRegistration.update({
        where: { stateId_name: { stateId: state.id, name: "panels" } },
        data: { workerVersionId: newVersion.id },
      })

      const newPanelIds = await panelService.setUnitPanels(
        project.id,
        state.id,
        newVersion.apiKeyId,
        newVersion.id,
        [{ name: "dashboard", meta: { title: "New Dashboard" } }],
        createId(),
      )
      await panelService.setUnitPanels(
        project.id,
        state.id,
        oldVersion.apiKeyId,
        oldVersion.id,
        [],
        createId(),
      )

      expect(newPanelIds).toEqual([panelId])
      await expect(
        projectDatabase.panel.findUnique({ where: { id: panelId } }),
      ).resolves.toMatchObject({
        workerVersionId: newVersion.id,
        meta: { title: "New Dashboard" },
      })
    },
  )
})
