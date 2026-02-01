import type { Logger } from "pino"
import type { BackendDatabaseBackend } from "../abstractions"
import type { BackendDatabase } from "../prisma"
import { randomBytes } from "node:crypto"
import { hostname } from "node:os"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { armor, Decrypter, Encrypter, identityToRecipient } from "age-encryption"
import { z } from "zod"
import { codebaseConfig, getCodebaseHighstatePath } from "../../common"
import { PrismaClient } from "../_generated/backend/sqlite/client"
import { migrateDatabase, migrationPacks } from "../migration"
import { ensureWellKnownEntitiesCreated } from "../well-known"
import {
  type BackendIdentityConfig,
  backendIdentityConfig,
  getOrCreateBackendIdentity,
} from "./keyring"
import { type DatabaseMetaFile, readMetaFile, writeMetaFile } from "./meta"

export const localBackendDatabaseConfig = z.object({
  ...codebaseConfig.shape,
  HIGHSTATE_BACKEND_DATABASE_LOCAL_PATH: z.string().optional(),
  ...backendIdentityConfig.shape,
  HIGHSTATE_ENCRYPTION_ENABLED: z.stringbool().default(true),
})

/**
 * Local implementation backed by a LibSQL database with optional encryption.
 */
class LocalBackendDatabaseBackend implements BackendDatabaseBackend {
  constructor(
    readonly database: BackendDatabase,
    private readonly databasePath: string,
    private readonly config: BackendIdentityConfig,
    private readonly logger: Logger,
    readonly isEncryptionEnabled: boolean,
  ) {}

  /**
   * Rewrites the encrypted master key to match the provided recipients.
   *
   * @param recipients AGE recipients that should retain access to the backend master key.
   */
  async reencryptMasterKey(recipients: string[]): Promise<void> {
    if (!this.isEncryptionEnabled) {
      return
    }

    const meta = await readMetaFile(this.databasePath)
    if (!meta?.masterKey) {
      this.logger.warn(
        { databasePath: this.databasePath },
        "backend meta file does not contain a master key; skipping re-encryption",
      )
      return
    }

    const identity = await getOrCreateBackendIdentity(this.config, this.logger)
    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)

    const plaintextMasterKey = await decrypter.decrypt(armor.decode(meta.masterKey), "text")

    const encrypter = new Encrypter()
    const allowedRecipients = new Set<string>(recipients)
    allowedRecipients.add(await identityToRecipient(identity))

    for (const recipient of allowedRecipients) {
      encrypter.addRecipient(recipient)
    }

    const encrypted = await encrypter.encrypt(plaintextMasterKey)

    await writeMetaFile(this.databasePath, {
      ...meta,
      masterKey: armor.encode(encrypted),
    })
  }
}

async function createMasterKey(config: BackendIdentityConfig, logger: Logger) {
  const identity = await getOrCreateBackendIdentity(config, logger)

  const masterKey = randomBytes(32).toString("hex")
  const encrypter = new Encrypter()

  const recipient = await identityToRecipient(identity)
  encrypter.addRecipient(recipient)

  const encryptedMasterKey = await encrypter.encrypt(masterKey)
  const armoredMasterKey = armor.encode(encryptedMasterKey)

  return { armoredMasterKey, masterKey, recipient }
}

type DatabaseInitializationResult = {
  masterKey?: string
  metaFile: DatabaseMetaFile
  created: boolean
  initialRecipient?: string
}

async function ensureDatabaseInitialized(
  databasePath: string,
  encryptionEnabled: boolean,
  config: BackendIdentityConfig,
  logger: Logger,
): Promise<DatabaseInitializationResult> {
  const meta = await readMetaFile(databasePath)

  if (!meta) {
    logger.info("creating new database")

    const masterKey = encryptionEnabled ? await createMasterKey(config, logger) : undefined

    const metaFile: DatabaseMetaFile = {
      version: 0,
      masterKey: masterKey?.armoredMasterKey,
    }

    return {
      masterKey: masterKey?.masterKey,
      metaFile,
      created: true,
      initialRecipient: masterKey?.recipient,
    }
  }

  if (!encryptionEnabled) {
    return {
      masterKey: undefined,
      metaFile: meta,
      created: false,
    }
  }

  if (!meta.masterKey) {
    throw new Error(
      `Database meta file at "${databasePath}/backend.meta.yaml" does not contain a master key.`,
    )
  }

  const identity = await getOrCreateBackendIdentity(config, logger)

  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)

  const encryptedMasterKey = armor.decode(meta.masterKey)
  const masterKey = await decrypter.decrypt(encryptedMasterKey, "text")

  return {
    masterKey,
    metaFile: meta,
    created: false,
  }
}

/**
 * Creates the local backend database backend with migrations applied.
 *
 * @param config Backend database configuration resolved from environment variables.
 * @param logger Logger scoped to backend startup.
 * @returns The backend database backend bound to the local LibSQL store.
 */
export async function createLocalBackendDatabaseBackend(
  config: z.infer<typeof localBackendDatabaseConfig>,
  logger: Logger,
): Promise<BackendDatabaseBackend> {
  if (!config.HIGHSTATE_ENCRYPTION_ENABLED) {
    logger.warn("local database encryption is disabled, this is not recommended for production use")
  }

  let databasePath = config.HIGHSTATE_BACKEND_DATABASE_LOCAL_PATH
  databasePath ??= await getCodebaseHighstatePath(config, logger)

  const { masterKey, metaFile, created, initialRecipient } = await ensureDatabaseInitialized(
    databasePath,
    config.HIGHSTATE_ENCRYPTION_ENABLED,
    config,
    logger,
  )

  const databaseUrl = `file:${databasePath}/backend.db`

  const adapter = new PrismaLibSql({
    url: databaseUrl,
    encryptionKey: masterKey,
  })

  const prismaClient = new PrismaClient({
    adapter,
  })

  await migrateDatabase(
    prismaClient,
    migrationPacks["backend/sqlite"],
    metaFile.version,
    async version => await writeMetaFile(databasePath, { ...metaFile, version }),
    logger,
  )

  const database = prismaClient as BackendDatabase

  await ensureWellKnownEntitiesCreated(database)

  const backendLogger = logger.child({ service: "LocalBackendDatabaseBackend" })

  await ensureInitialUnlockMethod(database, created, initialRecipient, backendLogger)

  return new LocalBackendDatabaseBackend(
    database,
    databasePath,
    config,
    backendLogger,
    config.HIGHSTATE_ENCRYPTION_ENABLED,
  )
}

/**
 * Derives the meta payload for the auto-generated backend unlock method.
 *
 * @param host Raw host name captured during backend initialization.
 */
export function getInitialBackendUnlockMethodMeta(host: string | undefined): {
  title: string
  description: string
} {
  const trimmed = host?.trim() ?? ""
  const title = trimmed.length > 0 ? trimmed : "initial"
  const description =
    trimmed.length > 0
      ? `Identity automatically registered for ${trimmed} when this backend database was created.`
      : "Identity automatically registered when this backend database was created."

  return { title, description }
}

/**
 * Registers the machine that initialized the backend as the first unlock method.
 */
async function ensureInitialUnlockMethod(
  database: BackendDatabase,
  created: boolean,
  initialRecipient: string | undefined,
  logger: Logger,
): Promise<void> {
  if (!created || !initialRecipient) {
    return
  }

  const meta = getInitialBackendUnlockMethodMeta(hostname())

  await database.backendUnlockMethod.create({
    data: {
      recipient: initialRecipient,
      meta,
    },
  })

  logger.info(
    { title: meta.title, recipient: initialRecipient },
    "registered initial backend unlock method",
  )
}
