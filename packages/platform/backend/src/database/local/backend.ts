import type { Logger } from "pino"
import type { BackendDatabaseBackend } from "../abstractions"
import type { BackendDatabase } from "../prisma"
import { randomBytes } from "node:crypto"
import { hostname } from "node:os"
import { cuidv2d } from "@highstate/contract"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { armor, Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
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

const backendIdNamespace = "36d23d1d-b1ca-47d9-a5a3-664bb7aa250d"

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
    readonly backendId: string,
    readonly privateKey: string,
    private readonly databasePath: string,
    private readonly config: BackendIdentityConfig,
    private readonly logger: Logger,
    readonly isEncryptionEnabled: boolean,
  ) {}

  /**
   * Rewrites the encrypted backend secrets to match the provided recipients.
   *
   * @param recipients AGE recipients that should retain access to the backend secrets.
   */
  async reencryptSecrets(recipients: string[]): Promise<void> {
    const meta = await readMetaFile(this.databasePath)
    if (!meta?.privateKey) {
      this.logger.warn(
        `backend meta file "%s/backend.meta.yaml" does not contain a private key; skipping re-encryption`,
        this.databasePath,
      )
      return
    }

    const identity = await getOrCreateBackendIdentity(this.config, this.logger)
    const decrypter = new Decrypter()
    decrypter.addIdentity(identity)

    const allowedRecipients = new Set<string>(recipients)
    allowedRecipients.add(await identityToRecipient(identity))
    const plaintextPrivateKey = await decrypter.decrypt(armor.decode(meta.privateKey), "text")
    const privateKey = await encryptSecret(plaintextPrivateKey, allowedRecipients)
    const masterKey = meta.masterKey
      ? await encryptSecret(
          await decrypter.decrypt(armor.decode(meta.masterKey), "text"),
          allowedRecipients,
        )
      : undefined

    await writeMetaFile(this.databasePath, {
      ...meta,
      masterKey,
      privateKey,
    })
  }
}

async function createMasterKey(identity: string) {
  const masterKey = randomBytes(32).toString("hex")
  const recipient = await identityToRecipient(identity)
  const armoredMasterKey = await encryptSecret(masterKey, [recipient])

  return { armoredMasterKey, masterKey, recipient }
}

async function encryptSecret(secret: string, recipients: Iterable<string>): Promise<string> {
  const encrypter = new Encrypter()

  for (const recipient of recipients) {
    encrypter.addRecipient(recipient)
  }

  return armor.encode(await encrypter.encrypt(secret))
}

export async function createBackendPrivateKey(identity: string): Promise<{
  backendId: string
  encryptedPrivateKey: string
  privateKey: string
}> {
  const privateKey = await generateIdentity()
  const recipient = (await identityToRecipient(privateKey)).trim()
  const encryptionRecipient = await identityToRecipient(identity)

  return {
    backendId: cuidv2d(backendIdNamespace, recipient),
    encryptedPrivateKey: await encryptSecret(privateKey, [encryptionRecipient]),
    privateKey,
  }
}

export async function readBackendPrivateKey(
  encryptedPrivateKey: string,
  identity: string,
): Promise<{ backendId: string; privateKey: string }> {
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)

  const privateKey = await decrypter.decrypt(armor.decode(encryptedPrivateKey), "text")
  const recipient = (await identityToRecipient(privateKey)).trim()

  return {
    backendId: cuidv2d(backendIdNamespace, recipient),
    privateKey,
  }
}

type DatabaseInitializationResult = {
  backendId: string
  privateKey: string
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
  const identity = await getOrCreateBackendIdentity(config, logger)

  if (!meta) {
    logger.info("creating new database")

    const masterKey = encryptionEnabled ? await createMasterKey(identity) : undefined
    const privateKey = await createBackendPrivateKey(identity)

    const metaFile: DatabaseMetaFile = {
      version: 0,
      masterKey: masterKey?.armoredMasterKey,
      privateKey: privateKey.encryptedPrivateKey,
    }

    return {
      backendId: privateKey.backendId,
      privateKey: privateKey.privateKey,
      masterKey: masterKey?.masterKey,
      metaFile,
      created: true,
      initialRecipient: masterKey?.recipient,
    }
  }

  let privateKey: { backendId: string; privateKey: string }
  let metaFile = meta

  if (meta.privateKey) {
    privateKey = await readBackendPrivateKey(meta.privateKey, identity)
  } else {
    const createdPrivateKey = await createBackendPrivateKey(identity)
    privateKey = createdPrivateKey
    metaFile = { ...meta, privateKey: createdPrivateKey.encryptedPrivateKey }
    await writeMetaFile(databasePath, metaFile)
  }

  if (!encryptionEnabled) {
    return {
      backendId: privateKey.backendId,
      privateKey: privateKey.privateKey,
      masterKey: undefined,
      metaFile,
      created: false,
    }
  }

  if (!metaFile.masterKey) {
    throw new Error(
      `Database meta file at "${databasePath}/backend.meta.yaml" does not contain a master key.`,
    )
  }

  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)

  const encryptedMasterKey = armor.decode(metaFile.masterKey)
  const masterKey = await decrypter.decrypt(encryptedMasterKey, "text")

  return {
    backendId: privateKey.backendId,
    privateKey: privateKey.privateKey,
    masterKey,
    metaFile,
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

  const { backendId, privateKey, masterKey, metaFile, created, initialRecipient } =
    await ensureDatabaseInitialized(
      databasePath,
      config.HIGHSTATE_ENCRYPTION_ENABLED,
      config,
      logger,
    )

  logger.info(`backend id: %s`, backendId)

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
    backendId,
    privateKey,
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
    `registered initial backend unlock method "%s" with recipient "%s"`,
    meta.title,
    initialRecipient,
  )
}
