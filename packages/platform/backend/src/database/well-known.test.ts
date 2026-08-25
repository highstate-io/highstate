import { adminBackendServiceAccount } from "../shared/models/backend/well-known"
import { adminProjectServiceAccount } from "../shared/models/project/well-known"
import { test } from "../test-utils"
import { ensureAdminProjectBindingCreated } from "./well-known"

test("maintains the Admin service account project binding", async ({
  database,
  project,
  projectDatabase,
  expect,
}) => {
  const backendServiceAccount = await database.backend.backendServiceAccount.findUniqueOrThrow({
    where: { systemName: adminBackendServiceAccount.systemName },
  })
  const projectServiceAccount = await projectDatabase.serviceAccount.findUniqueOrThrow({
    where: { systemName: adminProjectServiceAccount.systemName },
  })

  await database.backend.backendServiceAccountProjectBinding.update({
    where: {
      backendServiceAccountId_projectId: {
        backendServiceAccountId: backendServiceAccount.id,
        projectId: project.id,
      },
    },
    data: { projectServiceAccountId: "stale-service-account-id" },
  })

  await ensureAdminProjectBindingCreated(database.backend, projectDatabase, project.id)

  await expect(
    database.backend.backendServiceAccountProjectBinding.findUnique({
      where: {
        backendServiceAccountId_projectId: {
          backendServiceAccountId: backendServiceAccount.id,
          projectId: project.id,
        },
      },
    }),
  ).resolves.toMatchObject({ projectServiceAccountId: projectServiceAccount.id })
})
