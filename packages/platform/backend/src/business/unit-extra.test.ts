import type { UnitPage, UnitTerminal, UnitTrigger } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { test } from "../test-utils"
import { UnitExtraService } from "./unit-extra"

describe("UnitExtraService", () => {
  describe("processUnitTerminals", () => {
    test("should create new terminals", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const unitTerminals: UnitTerminal[] = [
        {
          name: "ssh",
          meta: {
            title: "SSH Terminal",
            description: "Secure shell access to the server",
            icon: "mdi:terminal",
            iconColor: "#4CAF50",
          },
          spec: {
            image: "alpine:3.18",
            command: ["ssh", "-o", "StrictHostKeyChecking=no"],
            cwd: "/root",
            env: {
              TERM: "xterm-256color",
              SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
            },
            files: {
              "/root/.ssh/config": {
                meta: {
                  name: "ssh-config",
                },

                content: {
                  type: "embedded",
                  value: "Host *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3\n",
                },
              },
            },
          },
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTerminals(tx, instance.id, unitTerminals)
      })
      const terminals = await projectDatabase.terminal.findMany({ where: { stateId: instance.id } })

      expect(terminals).toHaveLength(1)
      expect(terminals[0].name).toBe("ssh")
      expect(terminals[0].status).toBe("active")
      expect(terminals[0].meta).toEqual({
        title: "SSH Terminal",
        description: "Secure shell access to the server",
        icon: "mdi:terminal",
        iconColor: "#4CAF50",
      })
      expect(terminals[0].spec).toMatchObject({
        image: "alpine:3.18",
        command: ["ssh", "-o", "StrictHostKeyChecking=no"],
      })
    })

    test("should update existing terminals", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      await projectDatabase.terminal.create({
        data: {
          stateId: instance.id,
          name: "ssh",
          meta: {
            title: "Old Terminal",
            icon: "mdi:console",
          },
          spec: {
            image: "ubuntu:20.04",
            command: ["bash"],
          },
          status: "active",
        },
      })

      const unitTerminals: UnitTerminal[] = [
        {
          name: "ssh",
          meta: {
            title: "SSH Terminal",
            description: "Updated terminal with SSH access",
            icon: "mdi:terminal",
          },
          spec: {
            image: "alpine:3.18",
            command: ["ssh", "-i", "/root/.ssh/id_rsa"],
            env: {
              TERM: "xterm-256color",
            },
          },
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTerminals(tx, instance.id, unitTerminals)
      })

      const terminals = await projectDatabase.terminal.findMany({ where: { stateId: instance.id } })

      expect(terminals).toHaveLength(1)
      expect(terminals[0].meta).toEqual({
        title: "SSH Terminal",
        description: "Updated terminal with SSH access",
        icon: "mdi:terminal",
      })
      expect(terminals[0].spec).toMatchObject({
        image: "alpine:3.18",
        command: ["ssh", "-i", "/root/.ssh/id_rsa"],
      })
      expect(terminals[0].status).toBe("active")
    })

    test("should mark dangling terminals as unavailable", async ({
      database,
      project,
      createInstanceState,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const db = await database.forProject(project.id)
      await db.terminal.createMany({
        data: [
          {
            stateId: instance.id,
            name: "ssh",
            meta: { title: "SSH Terminal" },
            spec: { image: "alpine", command: ["ssh"] },
            status: "active",
          },
          {
            stateId: instance.id,
            name: "backup",
            meta: { title: "Backup Terminal" },
            spec: { image: "restic", command: ["restic"] },
            status: "active",
          },
        ],
      })

      const unitTerminals: UnitTerminal[] = [
        {
          name: "ssh",
          meta: {
            title: "SSH Terminal",
            icon: "mdi:terminal",
          },
          spec: {
            image: "alpine:3.18",
            command: ["ssh"],
          },
        },
      ]

      await db.$transaction(async tx => {
        await service.processUnitTerminals(tx, instance.id, unitTerminals)
      })

      const terminals = await db.terminal.findMany({
        where: { stateId: instance.id },
        orderBy: { name: "asc" },
      })

      expect(terminals).toHaveLength(2)
      expect(terminals[0].name).toBe("backup")
      expect(terminals[0].status).toBe("unavailable")
      expect(terminals[1].name).toBe("ssh")
      expect(terminals[1].status).toBe("active")
    })

    test("should not affect already unavailable terminals", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      await projectDatabase.terminal.create({
        data: {
          stateId: instance.id,
          name: "old-terminal",
          meta: { title: "Old Terminal" },
          spec: { image: "ubuntu", command: ["bash"] },
          status: "unavailable",
        },
      })

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTerminals(tx, instance.id, [])
      })

      const terminals = await projectDatabase.terminal.findMany({ where: { stateId: instance.id } })

      expect(terminals).toHaveLength(1)
      expect(terminals[0].status).toBe("unavailable")
    })
  })

  describe("processUnitPages", () => {
    test("should create new pages", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const unitPages: UnitPage[] = [
        {
          name: "dashboard",
          meta: {
            title: "Kubernetes Dashboard",
            description: "Access to the Kubernetes dashboard with login token",
            icon: "simple-icons:kubernetes",
            iconColor: "#326CE5",
          },
          content: [
            {
              type: "markdown",
              content: `# Kubernetes Dashboard

The dashboard is ready at [https://k8s.example.com](https://k8s.example.com)

To login, use the following token:`,
            },
            {
              type: "qr",
              content: "eyJhbGciOiJSUzI1NiIsImtpZCI6InRva2VuIn0...",
              showContent: true,
              language: "text",
            },
          ],
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitPages(tx, instance.id, unitPages)
      })

      const pages = await projectDatabase.page.findMany({ where: { stateId: instance.id } })

      expect(pages).toHaveLength(1)
      expect(pages[0].name).toBe("dashboard")
      expect(pages[0].meta).toEqual({
        title: "Kubernetes Dashboard",
        description: "Access to the Kubernetes dashboard with login token",
        icon: "simple-icons:kubernetes",
        iconColor: "#326CE5",
      })
      expect(pages[0].content).toHaveLength(2)
      expect(pages[0].content[0]).toMatchObject({
        type: "markdown",
        content: expect.stringContaining("Kubernetes Dashboard"),
      })
    })

    test("should update existing pages", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const db = await database.forProject(project.id)
      await db.page.create({
        data: {
          stateId: instance.id,
          name: "dashboard",
          meta: {
            title: "Old Dashboard",
            icon: "mdi:view-dashboard",
          },
          content: [
            {
              type: "markdown",
              content: "Old content",
            },
          ],
        },
      })

      const unitPages: UnitPage[] = [
        {
          name: "dashboard",
          meta: {
            title: "Updated Dashboard",
            description: "Updated dashboard with new features",
            icon: "mdi:monitor-dashboard",
          },
          content: [
            {
              type: "markdown",
              content: "# Updated Dashboard\n\nNew features available!",
            },
          ],
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitPages(tx, instance.id, unitPages)
      })

      const pages = await projectDatabase.page.findMany({ where: { stateId: instance.id } })

      expect(pages).toHaveLength(1)
      expect(pages[0].meta).toEqual({
        title: "Updated Dashboard",
        description: "Updated dashboard with new features",
        icon: "mdi:monitor-dashboard",
      })
      expect(pages[0].content).toHaveLength(1)
    })

    test("should delete dangling pages", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const db = await database.forProject(project.id)
      await db.page.createMany({
        data: [
          {
            stateId: instance.id,
            name: "dashboard",
            meta: { title: "Dashboard" },
            content: [],
          },
          {
            stateId: instance.id,
            name: "settings",
            meta: { title: "Settings" },
            content: [],
          },
        ],
      })

      const unitPages: UnitPage[] = [
        {
          name: "dashboard",
          meta: {
            title: "Dashboard",
          },
          content: [
            {
              type: "markdown",
              content: "Dashboard content",
            },
          ],
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitPages(tx, instance.id, unitPages)
      })

      const pages = await projectDatabase.page.findMany({ where: { stateId: instance.id } })

      expect(pages).toHaveLength(1)
      expect(pages[0].name).toBe("dashboard")
    })
  })

  describe("processUnitTriggers", () => {
    test("should create new triggers", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const unitTriggers: UnitTrigger[] = [
        {
          name: "cleanup",
          meta: {
            title: "Cleanup Before Destroy",
            description: "Runs backup and cleanup operations before instance destruction",
            icon: "mdi:backup-restore",
          },
          spec: {
            type: "before-destroy",
          },
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTriggers(tx, instance.id, unitTriggers)
      })

      const triggers = await projectDatabase.trigger.findMany({ where: { stateId: instance.id } })

      expect(triggers).toHaveLength(1)
      expect(triggers[0].name).toBe("cleanup")
      expect(triggers[0].meta).toEqual({
        title: "Cleanup Before Destroy",
        description: "Runs backup and cleanup operations before instance destruction",
        icon: "mdi:backup-restore",
      })
      expect(triggers[0].spec).toEqual({
        type: "before-destroy",
      })
    })

    test("should update existing triggers", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const db = await database.forProject(project.id)
      await db.trigger.create({
        data: {
          stateId: instance.id,
          name: "cleanup",
          meta: {
            title: "Old Cleanup",
            icon: "mdi:delete",
          },
          spec: {
            type: "before-destroy",
          },
        },
      })

      const unitTriggers: UnitTrigger[] = [
        {
          name: "cleanup",
          meta: {
            title: "Advanced Cleanup",
            description: "Enhanced cleanup with backup verification",
            icon: "mdi:backup-restore",
            iconColor: "#FF9800",
          },
          spec: {
            type: "before-destroy",
          },
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTriggers(tx, instance.id, unitTriggers)
      })

      const triggers = await projectDatabase.trigger.findMany({ where: { stateId: instance.id } })

      expect(triggers).toHaveLength(1)
      expect(triggers[0].meta).toEqual({
        title: "Advanced Cleanup",
        description: "Enhanced cleanup with backup verification",
        icon: "mdi:backup-restore",
        iconColor: "#FF9800",
      })
      expect(triggers[0].spec).toEqual({
        type: "before-destroy",
      })
    })

    test("should delete dangling triggers", async ({
      database,
      project,
      createInstanceState,
      projectDatabase,
    }) => {
      const service = new UnitExtraService(database)
      const instance = await createInstanceState(project.id)

      const db = await database.forProject(project.id)
      await db.trigger.createMany({
        data: [
          {
            stateId: instance.id,
            name: "cleanup",
            meta: { title: "Cleanup" },
            spec: { type: "before-destroy" },
          },
          {
            stateId: instance.id,
            name: "backup",
            meta: { title: "Backup" },
            spec: { type: "before-destroy" },
          },
        ],
      })

      const unitTriggers: UnitTrigger[] = [
        {
          name: "cleanup",
          meta: {
            title: "Cleanup Before Destroy",
          },
          spec: {
            type: "before-destroy",
          },
        },
      ]

      await projectDatabase.$transaction(async tx => {
        await service.processUnitTriggers(tx, instance.id, unitTriggers)
      })

      const triggers = await projectDatabase.trigger.findMany({ where: { stateId: instance.id } })

      expect(triggers).toHaveLength(1)
      expect(triggers[0].name).toBe("cleanup")
    })
  })
})

describe("pruneInstanceArtifacts", () => {
  test("removes artifacts not included in the keep list", async ({
    database,
    project,
    createInstanceState,
    projectDatabase,
  }) => {
    const service = new UnitExtraService(database)
    const instance = await createInstanceState(project.id)

    const artifactToKeep = await projectDatabase.artifact.create({
      data: {
        hash: createId(),
        size: 1024,
        chunkSize: 1024,
        meta: { title: "keep" },
        instances: {
          connect: { id: instance.id },
        },
      },
      select: { id: true },
    })

    const artifactToRemove = await projectDatabase.artifact.create({
      data: {
        hash: createId(),
        size: 512,
        chunkSize: 1024,
        meta: { title: "remove" },
        instances: {
          connect: { id: instance.id },
        },
      },
      select: { id: true },
    })

    await projectDatabase.$transaction(async tx => {
      await service.pruneInstanceArtifacts(tx, instance.id, [artifactToKeep.id])
    })

    const remaining = await projectDatabase.artifact.findMany({
      where: {
        instances: {
          some: {
            id: instance.id,
          },
        },
      },
      select: { id: true },
    })

    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(artifactToKeep.id)

    const removed = await projectDatabase.artifact.findUniqueOrThrow({
      where: { id: artifactToRemove.id },
      include: { instances: true },
    })
    expect(removed.instances).toHaveLength(0)
  })

  test("removes all artifacts when keep list is empty", async ({
    database,
    project,
    createInstanceState,
    projectDatabase,
  }) => {
    const service = new UnitExtraService(database)
    const instance = await createInstanceState(project.id)

    await projectDatabase.artifact.create({
      data: {
        hash: createId(),
        size: 128,
        chunkSize: 1024,
        meta: { title: "artifact-1" },
        instances: {
          connect: { id: instance.id },
        },
      },
    })

    await projectDatabase.artifact.create({
      data: {
        hash: createId(),
        size: 256,
        chunkSize: 1024,
        meta: { title: "artifact-2" },
        instances: {
          connect: { id: instance.id },
        },
      },
    })

    await projectDatabase.$transaction(async tx => {
      await service.pruneInstanceArtifacts(tx, instance.id, [])
    })

    const remaining = await projectDatabase.artifact.findMany({
      where: {
        instances: {
          some: {
            id: instance.id,
          },
        },
      },
    })

    expect(remaining).toHaveLength(0)
  })
})
