import { type CommonObjectMeta, getInstanceId, type VersionedName } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import pino, { type Logger } from "pino"
import { test as baseTest } from "vitest"
import {
  type InstanceState,
  type Project,
  type ProjectDatabase,
  projectDatabaseVersion,
} from "../database"
import { type ProjectInput, projectInputSchema } from "../shared"
import { TestDatabaseManager } from "./database"

export const test = baseTest.extend<{
  logger: Logger
  database: TestDatabaseManager
  createProject: (name: string, input?: Partial<ProjectInput>) => Promise<Project>

  /**
   * The shared project scoped to the test.
   */
  project: Project

  /**
   * The database for the `project`.
   */
  projectDatabase: ProjectDatabase

  /**
   * Creates a new instance state with random name.
   *
   * @param projectId The ID of the project containing the instance.
   * @param componentType The type of the component to create the instance state for. By default, `component.v1`.
   * @param kind The kind of the instance. By default, `unit`.
   */
  createInstanceState: (
    projectId: string,
    componentType?: VersionedName,
    kind?: string,
  ) => Promise<InstanceState>
}>({
  logger: [
    async ({}, use) => {
      const logger = pino({ level: "silent" })

      await use(logger)
    },
    { scope: "file" },
  ],

  database: [
    async ({ logger }, use) => {
      const database = await TestDatabaseManager.create(logger)

      try {
        await use(database)
      } finally {
        await database.cleanup()
      }
    },
    { scope: "file" },
  ],

  createProject: [
    async ({ database }, use) => {
      const createTestProject = async (name: string, input: Partial<ProjectInput> = {}) => {
        const meta: CommonObjectMeta = {
          title: "Test Project",
          description: "This is a test project",
          ...input.meta,
        }

        const resolvedInput = projectInputSchema.parse({ meta, name, ...input })

        return await database.backend.project.create({
          data: {
            ...resolvedInput,
            databaseVersion: projectDatabaseVersion,
            encryptedMasterKey: "",
            unlockSuite: { encryptedIdentities: [], hasPasskey: false },
          },
        })
      }

      await use(createTestProject)
    },
    { scope: "file" },
  ],

  project: [
    async ({ createProject }, use) => {
      const project = await createProject("shared")

      await use(project)
    },
    { scope: "file" },
  ],

  projectDatabase: [
    async ({ database, project }, use) => {
      const projectDatabase = await database.forProject(project.id)

      await use(projectDatabase)
    },
    { scope: "file" },
  ],

  createInstanceState: [
    async ({ database }, use) => {
      const createInstanceState = async (
        projectId: string,
        componentType: VersionedName = "component.v1",
        kind: string = "unit",
      ) => {
        const db = await database.forProject(projectId)

        const instanceId = createId()
        return await db.instanceState.create({
          data: {
            instanceId: getInstanceId(componentType, instanceId),
            kind,
            status: "undeployed",
            source: "resident",
          },
        })
      }

      await use(createInstanceState)
    },
    { scope: "file" },
  ],
})

export const testBase = test
