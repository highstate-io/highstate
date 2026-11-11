import type { SelectedLibraryPackage } from "@highstate/contract"
import type { ProjectDatabase } from "./prisma"

/**
 * Records the initial package selection once, before package resolution starts.
 * The explicit marker distinguishes an intentional empty selection from an uninitialized project.
 */
export async function initializeProjectLibrarySelection(
  database: ProjectDatabase,
  selectedPackages: SelectedLibraryPackage[],
): Promise<void> {
  await database.projectLibraryState.upsert({
    where: { id: "default" },
    create: { id: "default", selectedPackages, selectionInitialized: true },
    update: {},
  })

  await database.projectLibraryState.updateMany({
    where: { id: "default", selectionInitialized: false },
    data: { selectedPackages, selectionInitialized: true },
  })
}
