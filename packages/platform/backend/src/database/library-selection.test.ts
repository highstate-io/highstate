import { test } from "../test-utils"
import { initializeProjectLibrarySelection } from "./library-selection"

test("retains exact initial versions before resolution and ignores later bootstrap defaults", async ({
  database,
  createProject,
  expect,
}) => {
  const project = await createProject("initial-selection")
  const db = await database.forProject(project.id)
  const selectedPackages = [{ packageName: "@example/library", version: "1.2.3" }]
  await initializeProjectLibrarySelection(db, selectedPackages)

  await initializeProjectLibrarySelection(db, [
    { packageName: "@example/library", version: "2.0.0" },
  ])

  expect(
    await db.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }),
  ).toMatchObject({ selectedPackages, selectionInitialized: true, desiredSnapshotId: null })
})

test("an intentionally empty initial selection is not reseeded on later unlocks", async ({
  database,
  createProject,
  expect,
}) => {
  const project = await createProject("empty-initial-selection")
  const db = await database.forProject(project.id)
  await initializeProjectLibrarySelection(db, [])

  await initializeProjectLibrarySelection(db, [
    { packageName: "@example/library", version: "1.2.3" },
  ])

  expect(
    await db.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }),
  ).toMatchObject({ selectedPackages: [], selectionInitialized: true, desiredSnapshotId: null })
})
