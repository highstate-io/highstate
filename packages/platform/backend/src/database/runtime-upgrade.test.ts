import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import pino from "pino"
import { afterEach, expect, test } from "vitest"
import { PrismaClient as BackendClient } from "./_generated/backend/sqlite/client"
import { type MigrationClient, migrateDatabase, migrationPacks } from "./migration"
import { ProjectDatabase } from "./prisma"

const cleanups: (() => Promise<void>)[] = []
const logger = pino({ level: "silent" })

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function openDatabase(kind: "backend"): Promise<BackendClient>
async function openDatabase(kind: "project"): Promise<ProjectDatabase>
async function openDatabase(kind: "backend" | "project") {
  const directory = await mkdtemp(join(tmpdir(), "highstate-runtime-upgrade-"))
  const adapter = new PrismaLibSql({ url: `file:${join(directory, "database.db")}` })

  const client =
    kind === "backend" ? new BackendClient({ adapter }) : new ProjectDatabase({ adapter })

  cleanups.push(async () => {
    await client.$disconnect()
    await rm(directory, { recursive: true, force: true })
  })

  await client.$executeRawUnsafe("PRAGMA foreign_keys=ON")
  return client
}

async function migrate(client: MigrationClient, kind: "backend" | "project", old = false) {
  const pack = migrationPacks[kind === "backend" ? "backend/sqlite" : "project"]

  const oldVersion = pack.migrationNames.indexOf(
    kind === "backend"
      ? "20261025160007_runtime_redesign"
      : "20261025160007_project_library_snapshots",
  )

  const migrations = old
    ? { ...pack, migrationNames: pack.migrationNames.slice(0, oldVersion) }
    : pack

  await migrateDatabase(client, migrations, 0, async () => {}, logger)
}

test("upgrades populated backend databases without losing project links, keys, or host identifiers", async () => {
  const client = await openDatabase("backend")
  await migrate(client, "backend", true)
  await client.$executeRawUnsafe(`INSERT INTO "ProjectSpace" (id, meta) VALUES ('space', '{}')`)

  await client.$executeRawUnsafe(
    `INSERT INTO "ProjectModelStorage" (id, meta, spec) VALUES ('storage', '{}', '{"type":"database"}')`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "Library" (id, meta, spec) VALUES ('old-library', '{}', '{"type":"host"}')`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "PulumiBackend" (id, meta, spec) VALUES ('old-pulumi', '{"title":"Production state"}', '{"type":"host"}')`,
  )

  for (const id of ["project", "source"]) {
    await client.$executeRawUnsafe(
      `INSERT INTO "Project" (id, meta, name, "spaceId", "modelStorageId", "libraryId", "pulumiBackendId", "encryptedMasterKey", "encryptedPrivateKey", "publicKey", "unlockSuite", "databaseVersion", "updatedAt") VALUES ('${id}', '{"title":"Existing"}', '${id}', 'space', 'storage', 'old-library', 'old-pulumi', 'encrypted-master', 'encrypted-private', 'public-key', '{"encryptedIdentities":[],"hasPasskey":false}', 7, CURRENT_TIMESTAMP)`,
    )
  }

  await client.$executeRawUnsafe(
    `INSERT INTO "ProjectImportPort" ("projectId", "sourceProjectId", "sourceStateId", "contentHash", "encryptedContent") VALUES ('project', 'source', 'export-state', 'hash', 'encrypted-import')`,
  )

  const pack = migrationPacks["backend/sqlite"]
  const versions: number[] = []

  await migrateDatabase(
    client,
    pack,
    pack.migrationNames.length - 1,
    async version => {
      versions.push(version)
    },
    logger,
  )

  const backend = client as BackendClient
  const project = await backend.project.findUniqueOrThrow({ where: { id: "project" } })

  expect(project).toMatchObject({
    containerRuntimeId: "local",
    pulumiStateBackendId: "old-pulumi",
    databaseVersion: 7,
    encryptedMasterKey: "encrypted-master",
    encryptedPrivateKey: "encrypted-private",
    publicKey: "public-key",
    legacyExecutionConfig: {
      libraryId: "old-library",
      pulumiBackendId: "old-pulumi",
      librarySpec: { type: "host" },
      pulumiBackendSpec: { type: "host" },
    },
  })

  expect(await backend.projectImportPort.findMany()).toMatchObject([
    { projectId: "project", encryptedContent: "encrypted-import" },
  ])

  expect(
    await backend.pulumiStateBackend.findUniqueOrThrow({ where: { id: "old-pulumi" } }),
  ).toMatchObject({ spec: { url: "legacy:host" } })

  expect(versions).toEqual([pack.migrationNames.length])
  expect(await client.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([])
  expect(await client.$queryRawUnsafe("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }])
})

test("invalidates old evaluation cache while preserving deployed and operation history with unknown provenance", async () => {
  const client = await openDatabase("project")
  await migrate(client, "project", true)

  await client.$executeRawUnsafe(
    `INSERT INTO "InstanceState" (id, "instanceId", status, source, kind, model, "selfHash", "currentResourceCount") VALUES ('state', 'test.v1:deployed', 'deployed', 'virtual', 'unit', '{"name":"historical"}', 42, 3)`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "InstanceEvaluationState" ("stateId", status, model, "evaluatedAt") VALUES ('state', 'evaluated', '{"name":"cached"}', CURRENT_TIMESTAMP)`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "Operation" (id, meta, type, status, options, "requestedInstanceIds", "updatedAt") VALUES ('operation', '{}', 'update', 'completed', '{}', '[]', CURRENT_TIMESTAMP)`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "InstanceOperationState" ("operationId", "stateId", status, model, "resolvedInputs") VALUES ('operation', 'state', 'updated', '{"name":"historical"}', '{}')`,
  )

  await client.$executeRawUnsafe(
    `INSERT INTO "OperationLog" (id, "operationId", "stateId", "isSystem", content) VALUES ('log', 'operation', 'state', false, 'deployment output')`,
  )

  const pack = migrationPacks.project
  const oldVersion = pack.migrationNames.indexOf("20261025160007_project_library_snapshots")
  await migrateDatabase(client, pack, oldVersion, async () => {}, logger)

  const project = client as ProjectDatabase
  expect(await project.instanceEvaluationState.count()).toBe(0)

  expect(await project.instanceState.findUniqueOrThrow({ where: { id: "state" } })).toMatchObject({
    status: "deployed",
    model: { name: "historical" },
    selfHash: 42,
    currentResourceCount: 3,
    librarySnapshotId: null,
    libraryPackageVersionId: null,
  })

  expect(await project.instanceOperationState.findMany()).toMatchObject([
    {
      status: "updated",
      model: { name: "historical" },
      librarySnapshotId: null,
      libraryPackageVersionId: null,
      previousLibraryPackageVersionId: null,
      localOverlayRevision: null,
    },
  ])

  expect(await project.operation.findUniqueOrThrow({ where: { id: "operation" } })).toMatchObject({
    status: "completed",
    librarySnapshotId: null,
  })

  expect(await project.operationLog.findMany()).toMatchObject([{ content: "deployment output" }])

  expect(
    await project.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }),
  ).toMatchObject({ selectedPackages: [], desiredSnapshotId: null })

  expect(await client.$queryRawUnsafe("PRAGMA foreign_key_check")).toEqual([])
})

test("fresh registered migrations allow persisted workload/action and exact package selection round trips", async () => {
  const backend = (await openDatabase("backend")) as BackendClient
  const project = (await openDatabase("project")) as ProjectDatabase
  await migrate(backend, "backend")
  await migrate(project, "project")
  await backend.projectSpace.create({ data: { id: "space", meta: { title: "Space" } } })

  await backend.projectModelStorage.create({
    data: { id: "storage", meta: { title: "Storage" }, spec: { type: "database" } },
  })

  await backend.project.create({
    data: {
      id: "project",
      name: "fresh",
      meta: { title: "Project" },
      spaceId: "space",
      modelStorageId: "storage",
      containerRuntimeId: "local",
      pulumiStateBackendId: "local",
      encryptedMasterKey: "",
      unlockSuite: { encryptedIdentities: [], hasPasskey: false, passkeys: [] },
      databaseVersion: migrationPacks.project.migrationNames.length,
    },
  })

  const workload = await backend.runtimeWorkload.create({
    data: {
      runtimeId: "local",
      projectId: "project",
      kind: "composite_evaluation",
      ownerId: "generation",
    },
  })

  const action = await backend.runtimeAction.create({
    data: { workloadId: workload.id, kind: "composite_evaluation", ownerId: "generation" },
  })

  expect(
    await backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: workload.id },
      include: { actions: true },
    }),
  ).toMatchObject({ actions: [{ id: action.id }] })

  await project.projectLibraryState.update({
    where: { id: "default" },
    data: { selectedPackages: [{ packageName: "@example/library", version: "1.2.3" }] },
  })

  expect(
    await project.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }),
  ).toMatchObject({
    selectedPackages: [{ packageName: "@example/library", version: "1.2.3" }],
    desiredSnapshotId: null,
  })
})

test("a failed table rebuild rolls back data and version changes and restores foreign key enforcement", async () => {
  const client = await openDatabase("backend")
  await migrate(client, "backend", true)
  const pack = migrationPacks["backend/sqlite"]

  const failingClient: MigrationClient = {
    $executeRawUnsafe: query => client.$executeRawUnsafe(query),
    $queryRawUnsafe: query => client.$queryRawUnsafe(query),
    $transaction: callback =>
      client.$transaction(async tx => {
        await callback({
          $executeRawUnsafe: (query: string) => tx.$executeRawUnsafe(query),
          $queryRawUnsafe: async () => [
            { table: "Project", rowid: 1, parent: "ProjectSpace", fkid: 0 },
          ],
        })

        throw new Error("The migration should have rejected the foreign key violation")
      }),
  }

  const versions: number[] = []

  await expect(
    migrateDatabase(
      failingClient,
      pack,
      pack.migrationNames.length - 1,
      async version => {
        versions.push(version)
      },
      logger,
    ),
  ).rejects.toThrow("violates foreign key constraints")

  expect(versions).toEqual([])

  expect(
    await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Library'",
    ),
  ).toEqual([{ name: "Library" }])

  expect(
    await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ContainerRuntime'",
    ),
  ).toEqual([])

  expect(await client.$queryRawUnsafe("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }])
})
