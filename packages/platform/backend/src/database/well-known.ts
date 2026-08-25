import type { BackendDatabase, ProjectDatabase } from "./prisma"
import {
  adminBackendRole,
  adminBackendServiceAccount,
  codebaseLibrary,
  codebaseProjectModelStorage,
  databaseProjectModelStorage,
  globalProjectSpace,
  hostPulumiBackend,
} from "../shared/models/backend/well-known"
import { adminProjectRole, adminProjectServiceAccount } from "../shared/models/project/well-known"

export async function ensureWellKnownEntitiesCreated(database: BackendDatabase): Promise<void> {
  const [, , , , , adminRole, adminServiceAccount] = await database.$transaction([
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
    database.backendRole.upsert({
      where: { systemName: adminBackendRole.systemName },
      create: adminBackendRole,
      update: adminBackendRole,
    }),
    database.backendServiceAccount.upsert({
      where: { systemName: adminBackendServiceAccount.systemName },
      create: adminBackendServiceAccount,
      update: adminBackendServiceAccount,
    }),
  ])

  await database.serviceAccountBackendRoleBinding.upsert({
    where: {
      roleId_serviceAccountId: {
        roleId: adminRole.id,
        serviceAccountId: adminServiceAccount.id,
      },
    },
    create: {
      roleId: adminRole.id,
      serviceAccountId: adminServiceAccount.id,
    },
    update: {},
  })
}

export async function ensureProjectWellKnownEntitiesCreated(
  database: ProjectDatabase,
): Promise<void> {
  const [adminRole, adminServiceAccount] = await database.$transaction([
    database.role.upsert({
      where: { systemName: adminProjectRole.systemName },
      create: adminProjectRole,
      update: adminProjectRole,
    }),
    database.serviceAccount.upsert({
      where: { systemName: adminProjectServiceAccount.systemName },
      create: adminProjectServiceAccount,
      update: adminProjectServiceAccount,
    }),
  ])

  await database.serviceAccountRoleBinding.upsert({
    where: {
      roleId_serviceAccountId: {
        roleId: adminRole.id,
        serviceAccountId: adminServiceAccount.id,
      },
    },
    create: {
      roleId: adminRole.id,
      serviceAccountId: adminServiceAccount.id,
    },
    update: {},
  })
}

export async function ensureAdminProjectBindingCreated(
  backendDatabase: BackendDatabase,
  projectDatabase: ProjectDatabase,
  projectId: string,
): Promise<void> {
  const [backendServiceAccount, projectServiceAccount] = await Promise.all([
    backendDatabase.backendServiceAccount.findUniqueOrThrow({
      where: { systemName: adminBackendServiceAccount.systemName },
      select: { id: true },
    }),
    projectDatabase.serviceAccount.findUniqueOrThrow({
      where: { systemName: adminProjectServiceAccount.systemName },
      select: { id: true },
    }),
  ])

  await backendDatabase.backendServiceAccountProjectBinding.upsert({
    where: {
      backendServiceAccountId_projectId: {
        backendServiceAccountId: backendServiceAccount.id,
        projectId,
      },
    },
    create: {
      backendServiceAccountId: backendServiceAccount.id,
      projectId,
      projectServiceAccountId: projectServiceAccount.id,
    },
    update: { projectServiceAccountId: projectServiceAccount.id },
  })
}
