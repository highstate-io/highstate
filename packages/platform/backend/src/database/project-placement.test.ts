import { operationOptionsSchema } from "../shared"
import { test } from "../test-utils"
import { updateProjectPlacement } from "./project-placement"

test("remote placement disables the overlay, invalidates evaluation cache, and retains exact selection", async ({
  database,
  createProject,
  expect,
}) => {
  const project = await createProject("remote-placement")
  const projectDatabase = await database.forProject(project.id)
  const runtime = await database.backend.containerRuntime.create({
    data: {
      meta: { title: "Remote" },
      spec: {
        type: "docker",
        local: false,
        engineEndpoint: "https://docker.example.com",
        runtimeApiUrl: "https://runtime.example.com",
        imageRepository: "ghcr.io/example/project",
      },
    },
  })
  const instance = await projectDatabase.instanceState.create({
    data: {
      instanceId: "test.v1:composite",
      kind: "composite",
      status: "undeployed",
      source: "resident",
    },
  })
  await projectDatabase.instanceEvaluationState.create({
    data: {
      stateId: instance.id,
      status: "evaluated",
      modelRevision: "resident-revision",
      evaluationActionId: "actual-evaluation-action",
    },
  })
  await projectDatabase.projectLibraryState.update({
    where: { id: "default" },
    data: { selectedPackages: [{ packageName: "@example/library", version: "1.0.0" }] },
  })

  await updateProjectPlacement(database, project.id, {
    containerRuntimeId: runtime.id,
    pulumiStateBackendId: "local",
  })

  expect(
    await database.backend.project.findUniqueOrThrow({ where: { id: project.id } }),
  ).toMatchObject({ containerRuntimeId: runtime.id, pulumiStateBackendId: "local" })
  expect(
    await projectDatabase.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }),
  ).toMatchObject({
    localOverlayEnabled: false,
    selectedPackages: [{ packageName: "@example/library", version: "1.0.0" }],
  })
  expect(await projectDatabase.instanceEvaluationState.count()).toBe(0)
  await expect(
    updateProjectPlacement(database, project.id, {
      containerRuntimeId: runtime.id,
      pulumiStateBackendId: "local",
      localOverlayEnabled: true,
    }),
  ).rejects.toThrow("well-known local Docker")
})

test("placement rejects active and uncleaned workloads and permits a cleaned historical workload", async ({
  database,
  createProject,
  expect,
}) => {
  const project = await createProject("workload-placement")
  const workload = await database.backend.runtimeWorkload.create({
    data: { runtimeId: "local", projectId: project.id, kind: "pulumi", ownerId: "operation" },
  })
  const placement = { containerRuntimeId: "local", pulumiStateBackendId: "local" }
  await expect(updateProjectPlacement(database, project.id, placement)).rejects.toThrow(
    "active or uncleaned",
  )
  await database.backend.runtimeWorkload.update({
    where: { id: workload.id },
    data: { status: "completed" },
  })
  await expect(updateProjectPlacement(database, project.id, placement)).rejects.toThrow(
    "active or uncleaned",
  )
  await database.backend.runtimeWorkload.update({
    where: { id: workload.id },
    data: { cleanedUpAt: new Date() },
  })
  await expect(updateProjectPlacement(database, project.id, placement)).resolves.toBeUndefined()
})

test("placement rejects in-flight legacy operations even before runtime workload tracking", async ({
  database,
  createProject,
  expect,
}) => {
  const project = await createProject("operation-placement")
  const projectDatabase = await database.forProject(project.id)
  const operation = await projectDatabase.operation.create({
    data: {
      type: "update",
      status: "running",
      meta: { title: "Update" },
      options: operationOptionsSchema.parse({}),
      requestedInstanceIds: [],
    },
  })
  const placement = { containerRuntimeId: "local", pulumiStateBackendId: "local" }
  await expect(updateProjectPlacement(database, project.id, placement)).rejects.toThrow(
    "active operations",
  )
  await projectDatabase.operation.update({
    where: { id: operation.id },
    data: { status: "completed" },
  })
  await expect(updateProjectPlacement(database, project.id, placement)).resolves.toBeUndefined()
})
