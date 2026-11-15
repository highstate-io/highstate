import { randomUUID } from "node:crypto"
import { expect } from "vitest"
import { operationOptionsSchema } from "../shared"
import { test } from "../test-utils/services"
import { ProjectLibraryGarbageCollector } from "./garbage-collection"

test("collects orphaned snapshots and versions while retaining desired, deployed, operation, action and build history", async ({
  database,
  project,
  projectDatabase: db,
  createInstanceState,
}) => {
  const version = await db.libraryPackageVersion.create({
    data: {
      packageName: "@test/library",
      version: "1.0.0",
      registryUrl: "https://registry.npmjs.org/",
      packageIntegrity: "sha512-test",
      tarballUrl: "https://registry.npmjs.org/test.tgz",
      evaluatedModel: Buffer.from([]),
      sourceManifest: {},
      packageMetadata: {},
    },
  })

  const snapshot = async () =>
    await db.librarySnapshot.create({
      data: {
        hash: randomUUID(),
        lockfile: "{}",
        evaluatedModel: Buffer.from([]),
        sourceManifest: { packages: {}, owners: {} },
        compatibility: {
          runtimeProtocolVersion: 1,
          packageFormatVersion: 1,
          bunVersion: "1.3.13",
          pulumiVersion: "3.232.0",
        },
        versions: { create: { libraryPackageVersionId: version.id } },
      },
    })

  const desired = await snapshot()
  const deployed = await snapshot()
  const historical = await snapshot()
  const actionSnapshot = await snapshot()
  const buildSnapshot = await snapshot()
  const orphan = await snapshot()

  await db.projectLibraryState.update({
    where: { id: "default" },
    data: { desiredSnapshotId: desired.id },
  })

  const state = await createInstanceState(project.id)

  await db.instanceState.update({
    where: { id: state.id },
    data: { librarySnapshotId: deployed.id, libraryPackageVersionId: version.id },
  })

  await db.operation.create({
    data: {
      type: "update",
      meta: { title: "Historical operation" },
      options: operationOptionsSchema.parse({}),
      requestedInstanceIds: [],
      librarySnapshotId: historical.id,
    },
  })

  const workload = await database.backend.runtimeWorkload.create({
    data: {
      projectId: project.id,
      runtimeId: project.containerRuntimeId,
      kind: "pulumi",
      ownerId: "operation",
    },
  })

  await database.backend.runtimeAction.create({
    data: {
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "phase",
      snapshotId: actionSnapshot.id,
      status: "completed",
    },
  })

  const build = await database.backend.runtimeWorkload.create({
    data: {
      projectId: project.id,
      runtimeId: project.containerRuntimeId,
      kind: "library_build",
      ownerId: buildSnapshot.id,
    },
  })

  await database.backend.librarySnapshotImage.create({
    data: {
      projectId: project.id,
      runtimeId: project.containerRuntimeId,
      snapshotId: orphan.id,
      snapshotHash: orphan.hash,
    },
  })

  const gc = new ProjectLibraryGarbageCollector(database)
  expect(await gc.collect(project.id)).toEqual({ snapshots: 1, packageVersions: 0 })
  expect(await db.librarySnapshot.findUnique({ where: { id: orphan.id } })).toBeNull()
  expect(await db.librarySnapshot.count()).toBe(5)

  expect(
    await database.backend.librarySnapshotImage.count({ where: { snapshotId: orphan.id } }),
  ).toBe(0)

  await database.backend.runtimeWorkload.update({
    where: { id: build.id },
    data: { cleanedUpAt: new Date() },
  })

  expect(await gc.collect(project.id)).toEqual({ snapshots: 1, packageVersions: 0 })
  expect(await db.librarySnapshot.findUnique({ where: { id: actionSnapshot.id } })).not.toBeNull()
  expect(await gc.collect(project.id)).toEqual({ snapshots: 0, packageVersions: 0 })
})
