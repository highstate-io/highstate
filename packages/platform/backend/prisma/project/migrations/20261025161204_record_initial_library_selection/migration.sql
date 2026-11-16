-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectLibraryState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "selectedPackages" JSONB NOT NULL DEFAULT '[]',
    "selectionInitialized" BOOLEAN NOT NULL DEFAULT false,
    "desiredSnapshotId" TEXT,
    "localOverlayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectLibraryState_desiredSnapshotId_fkey" FOREIGN KEY ("desiredSnapshotId") REFERENCES "LibrarySnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProjectLibraryState" ("desiredSnapshotId", "id", "localOverlayEnabled", "selectedPackages", "updatedAt", "selectionInitialized") SELECT "desiredSnapshotId", "id", "localOverlayEnabled", "selectedPackages", "updatedAt", ("desiredSnapshotId" IS NOT NULL OR json_array_length("selectedPackages") > 0) FROM "ProjectLibraryState";
DROP TABLE "ProjectLibraryState";
ALTER TABLE "new_ProjectLibraryState" RENAME TO "ProjectLibraryState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
