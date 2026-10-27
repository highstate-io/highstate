import type { BackendDatabaseBackend } from "./abstractions"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaPg } from "@prisma/adapter-pg"
import { generateIdentity, identityToRecipient } from "age-encryption"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { artifactBackendConfig, createArtifactBackend } from "../artifact/factory"
import { MemoryProjectUnlockBackend } from "../unlock/memory"
import {
  createBackendDatabaseBackend,
  createProjectDatabaseBackend,
  databaseConfig,
} from "./factory"
import { readBackendPrivateKey } from "./local/backend"
import { DatabaseManagerImpl } from "./manager"
import { migrateDatabase, migrationPacks } from "./migration"
import { BackendDatabase } from "./prisma"

const logger = pino({ level: "silent" })
const postgresUrl = process.env.HIGHSTATE_TEST_POSTGRESQL_URL

describe.skipIf(!postgresUrl)("PostgreSQL backend storage", () => {
  const admin = new BackendDatabase({ adapter: new PrismaPg({ connectionString: postgresUrl }) })
  let schema: string
  let directory: string
  let identity: string
  let config: ReturnType<typeof databaseConfig.parse>
  const backends: BackendDatabaseBackend[] = []

  async function open() {
    const backend = await createBackendDatabaseBackend(config, logger)
    backends.push(backend)
    return backend
  }

  async function metadata() {
    const [row] = await admin.$queryRawUnsafe<{ version: number; privateKey: string }[]>(
      `SELECT "version", "privateKey" FROM "${schema}"."_highstate_backend"`,
    )
    return row
  }

  beforeEach(async () => {
    schema = `storage_test_${randomUUID().replaceAll("-", "")}`
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    directory = await mkdtemp(join(tmpdir(), "highstate-postgresql-"))
    identity = await generateIdentity()
    const identityPath = join(directory, "identity.age")
    await writeFile(identityPath, `${identity}\n`, { mode: 0o600 })
    const url = new URL(postgresUrl!)
    url.searchParams.set("schema", schema)
    config = databaseConfig.parse({
      HIGHSTATE_BACKEND_DATABASE_TYPE: "postgresql",
      HIGHSTATE_BACKEND_DATABASE_POSTGRESQL_URL: url.toString(),
      HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH: identityPath,
      HIGHSTATE_CODEBASE_PATH: directory,
    })
  })

  afterEach(async () => {
    await Promise.all(backends.splice(0).map(backend => backend.database.$disconnect()))
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.$disconnect()
    await rm(directory, { recursive: true, force: true })
  })

  it("persists encrypted federation identity across concurrent startup and recipient rotation", async () => {
    const [first, second] = await Promise.all([open(), open()])
    expect(second.backendId).toBe(first.backendId)
    expect(second.privateKey).toBe(first.privateKey)
    const initial = await metadata()
    expect(initial.version).toBe(migrationPacks["backend/postgresql"].migrationNames.length)
    expect(initial.privateKey).not.toContain(first.privateKey)
    expect(await first.database.backendUnlockMethod.count()).toBe(1)

    const recoveryIdentity = await generateIdentity()
    await first.reencryptSecrets([await identityToRecipient(recoveryIdentity)])
    const rotated = await metadata()
    expect(await readBackendPrivateKey(rotated.privateKey, recoveryIdentity)).toEqual({
      backendId: first.backendId,
      privateKey: first.privateKey,
    })
    expect((await open()).backendId).toBe(first.backendId)

    await first.reencryptSecrets([])
    const removed = await metadata()
    await expect(readBackendPrivateKey(removed.privateKey, recoveryIdentity)).rejects.toThrow()
    expect((await open()).privateKey).toBe(first.privateKey)
  })

  it("rejects missing or incorrect startup identity and disabled encryption without replacing metadata", async () => {
    await open()
    const initial = await metadata()
    config.HIGHSTATE_BACKEND_DATABASE_IDENTITY = await generateIdentity()
    await expect(open()).rejects.toThrow("Failed to initialize PostgreSQL backend storage")
    expect(await metadata()).toEqual(initial)
    config.HIGHSTATE_BACKEND_DATABASE_IDENTITY = undefined
    config.HIGHSTATE_BACKEND_DATABASE_IDENTITY_PATH = undefined
    await expect(open()).rejects.toThrow("stable backend AGE identity")
    config.HIGHSTATE_ENCRYPTION_ENABLED = false
    await expect(open()).rejects.toThrow("HIGHSTATE_ENCRYPTION_ENABLED=true")
    expect(await metadata()).toEqual(initial)
  })

  it("rejects newer database versions without downgrading them", async () => {
    await open()
    await admin.$executeRawUnsafe(`UPDATE "${schema}"."_highstate_backend" SET "version" = 999`)
    const initial = await metadata()
    await expect(open()).rejects.toMatchObject({
      cause: {
        currentVersion: 999,
        supportedVersion: migrationPacks["backend/postgresql"].migrationNames.length,
      },
    })
    expect(await metadata()).toEqual(initial)
  })

  it("rolls back initial schema and metadata when a migration fails", async () => {
    // A preexisting conflicting table forces failure after the initial migration has created other objects.
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."BackendRole" ("id" TEXT)`)
    await expect(open()).rejects.toThrow("Failed to initialize PostgreSQL backend storage")
    const [row] = await admin.$queryRawUnsafe<
      { metadata: string | null; project: string | null }[]
    >(
      `SELECT to_regclass('"${schema}"."_highstate_backend"')::text AS metadata,
       to_regclass('"${schema}"."Project"')::text AS project`,
    )
    expect(row).toEqual({ metadata: null, project: null })
    await admin.$executeRawUnsafe(`DROP TABLE "${schema}"."BackendRole"`)
    expect((await open()).backendId).toBeTruthy()
  })

  it("rolls back migration DDL when writing the version fails", async () => {
    // Apply a real registered migration with a failing transactional version writer.
    await expect(
      migrateDatabase(
        {
          $transaction: async callback =>
            await admin.$transaction(async tx => {
              await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
              return await callback(tx)
            }),
          $executeRawUnsafe: async sql => await admin.$executeRawUnsafe(sql),
        },
        migrationPacks["backend/postgresql"],
        0,
        async (_version, tx) => {
          await tx.$executeRawUnsafe(`SELECT 1 / 0`)
        },
        logger,
      ),
    ).rejects.toThrow()
    const [row] = await admin.$queryRawUnsafe<{ table: string | null }[]>(
      `SELECT to_regclass('"${schema}"."Project"')::text AS "table"`,
    )
    expect(row.table).toBeNull()
  })

  it("keeps project SQLite and artifact encryption enabled with the PostgreSQL factory", async () => {
    const backend = await open()
    const unlock = new MemoryProjectUnlockBackend()
    const key = randomBytes(32)
    const projectId = "encrypted-project"
    await unlock.unlockProject(projectId, key, await generateIdentity())
    const projects = await createProjectDatabaseBackend(config, logger)
    const manager = new DatabaseManagerImpl(backend, unlock, projects, config, logger)
    expect(manager.isEncryptionEnabled).toBe(true)
    expect(await manager.getProjectMasterKey(projectId)).toEqual(key)

    const project = await manager.setupDatabase(projectId)
    try {
      await project.$executeRawUnsafe('CREATE TABLE "EncryptionProbe" ("secret" TEXT)')
      await project.$executeRaw`INSERT INTO "EncryptionProbe" ("secret") VALUES ('project-secret-probe')`
      const databaseFile = await readFile(
        join(directory, ".highstate", "projects", projectId, "project.db"),
      )
      expect(databaseFile.subarray(0, 16).toString()).not.toBe("SQLite format 3\0")
      expect(databaseFile.includes(Buffer.from("project-secret-probe"))).toBe(false)
    } finally {
      await project.$disconnect()
    }

    const reopened = await projects.openProjectDatabase(projectId, key.toString("hex"))
    try {
      expect(await reopened.$queryRawUnsafe('SELECT "secret" FROM "EncryptionProbe"')).toEqual([
        { secret: "project-secret-probe" },
      ])
    } finally {
      await reopened.$disconnect()
    }

    const wrongKey = await projects.openProjectDatabase(projectId, randomBytes(32).toString("hex"))
    try {
      await expect(
        wrongKey.$queryRawUnsafe('SELECT "secret" FROM "EncryptionProbe"'),
      ).rejects.toThrow()
    } finally {
      await wrongKey.$disconnect()
    }

    const artifacts = await createArtifactBackend(
      artifactBackendConfig.parse({
        HIGHSTATE_CODEBASE_PATH: directory,
      }),
      manager,
      logger,
    )
    const plaintext = Buffer.from("artifact-secret-probe")
    await artifacts.store(
      projectId,
      "probe",
      65536,
      (async function* () {
        yield plaintext
      })(),
    )
    const path = join(directory, ".highstate", "projects", projectId, "artifacts", "probe.tgz.enc")
    await expect.poll(async () => (await readFile(path)).length).toBeGreaterThan(plaintext.length)
    expect((await readFile(path)).includes(plaintext)).toBe(false)
    const stream = await artifacts.retrieve(projectId, "probe", 65536)
    const chunks: Uint8Array[] = []
    for await (const chunk of stream!) {
      chunks.push(chunk)
    }
    expect(Buffer.concat(chunks)).toEqual(plaintext)
  })
})
