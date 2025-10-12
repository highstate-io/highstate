import type { BackendDatabase } from "./prisma"
import {
  codebaseLibrary,
  codebaseProjectModelStorage,
  databaseProjectModelStorage,
  globalProjectSpace,
  hostPulumiBackend,
} from "../shared/models/backend/well-known"

export async function ensureWellKnownEntitiesCreated(database: BackendDatabase): Promise<void> {
  await database.$transaction([
    database.projectSpace.upsert({
      where: { id: globalProjectSpace.id },
      create: globalProjectSpace,
      update: globalProjectSpace,
    }),
    database.library.upsert({
      where: { id: codebaseLibrary.id },
      create: codebaseLibrary,
      update: codebaseLibrary,
    }),
    database.pulumiBackend.upsert({
      where: { id: hostPulumiBackend.id },
      create: hostPulumiBackend,
      update: hostPulumiBackend,
    }),
    database.projectModelStorage.upsert({
      where: { id: codebaseProjectModelStorage.id },
      create: codebaseProjectModelStorage,
      update: codebaseProjectModelStorage,
    }),
    database.projectModelStorage.upsert({
      where: { id: databaseProjectModelStorage.id },
      create: databaseProjectModelStorage,
      update: databaseProjectModelStorage,
    }),
  ])
}
