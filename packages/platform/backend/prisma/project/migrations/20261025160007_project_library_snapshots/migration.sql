-- Cached evaluations predate action and resident-model revisions and must be recomputed.
-- Deployed instance models, operations, logs, and all existing provenance remain intact.
-- CreateTable
CREATE TABLE "LibraryPackageVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "registryUrl" TEXT NOT NULL,
    "packageIntegrity" TEXT NOT NULL,
    "tarballUrl" TEXT NOT NULL,
    "evaluatedModel" BLOB NOT NULL,
    "sourceManifest" JSONB NOT NULL,
    "packageMetadata" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LibrarySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "lockfile" TEXT NOT NULL,
    "evaluatedModel" BLOB NOT NULL,
    "sourceManifest" JSONB NOT NULL,
    "compatibility" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LibrarySnapshotVersion" (
    "snapshotId" TEXT NOT NULL,
    "libraryPackageVersionId" TEXT NOT NULL,

    PRIMARY KEY ("snapshotId", "libraryPackageVersionId"),
    CONSTRAINT "LibrarySnapshotVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LibrarySnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibrarySnapshotVersion_libraryPackageVersionId_fkey" FOREIGN KEY ("libraryPackageVersionId") REFERENCES "LibraryPackageVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectLibraryState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "selectedPackages" JSONB NOT NULL DEFAULT '[]',
    "desiredSnapshotId" TEXT,
    "localOverlayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectLibraryState_desiredSnapshotId_fkey" FOREIGN KEY ("desiredSnapshotId") REFERENCES "LibrarySnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "ProjectLibraryState" ("id", "selectedPackages", "localOverlayEnabled", "updatedAt")
VALUES ('default', '[]', true, CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InstanceEvaluationState" (
    "stateId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "model" JSONB,
    "librarySnapshotId" TEXT,
    "modelRevision" TEXT NOT NULL,
    "localOverlayRevision" TEXT,
    "evaluationActionId" TEXT NOT NULL,
    "evaluatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstanceEvaluationState_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstanceEvaluationState_librarySnapshotId_fkey" FOREIGN KEY ("librarySnapshotId") REFERENCES "LibrarySnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- There is no evidence of historical action IDs or model revisions. Invalidate this cache instead of inventing them.
DROP TABLE "InstanceEvaluationState";
ALTER TABLE "new_InstanceEvaluationState" RENAME TO "InstanceEvaluationState";
CREATE INDEX "InstanceEvaluationState_librarySnapshotId_idx" ON "InstanceEvaluationState"("librarySnapshotId");
CREATE INDEX "InstanceEvaluationState_modelRevision_idx" ON "InstanceEvaluationState"("modelRevision");
CREATE TABLE "new_InstanceOperationState" (
    "operationId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentResourceCount" INTEGER,
    "totalResourceCount" INTEGER,
    "model" JSONB NOT NULL,
    "resolvedInputs" JSONB NOT NULL,
    "librarySnapshotId" TEXT,
    "libraryPackageVersionId" TEXT,
    "previousLibraryPackageVersionId" TEXT,
    "localOverlayActive" BOOLEAN NOT NULL DEFAULT false,
    "localOverlayRevision" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,

    PRIMARY KEY ("operationId", "stateId"),
    CONSTRAINT "InstanceOperationState_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstanceOperationState_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstanceOperationState_librarySnapshotId_libraryPackageVersionId_fkey" FOREIGN KEY ("librarySnapshotId", "libraryPackageVersionId") REFERENCES "LibrarySnapshotVersion" ("snapshotId", "libraryPackageVersionId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstanceOperationState_previousLibraryPackageVersionId_fkey" FOREIGN KEY ("previousLibraryPackageVersionId") REFERENCES "LibraryPackageVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InstanceOperationState" ("currentResourceCount", "finishedAt", "model", "operationId", "resolvedInputs", "startedAt", "stateId", "status", "totalResourceCount") SELECT "currentResourceCount", "finishedAt", "model", "operationId", "resolvedInputs", "startedAt", "stateId", "status", "totalResourceCount" FROM "InstanceOperationState";
DROP TABLE "InstanceOperationState";
ALTER TABLE "new_InstanceOperationState" RENAME TO "InstanceOperationState";
CREATE TABLE "new_InstanceState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "inputHashNonce" INTEGER,
    "selfHash" INTEGER,
    "inputHash" INTEGER,
    "outputHash" INTEGER,
    "dependencyOutputHash" INTEGER,
    "exportedArtifactIds" JSONB,
    "model" JSONB,
    "resolvedInputs" JSONB,
    "currentResourceCount" INTEGER,
    "statusFields" JSONB,
    "hasResourceHooks" BOOLEAN NOT NULL DEFAULT false,
    "librarySnapshotId" TEXT,
    "libraryPackageVersionId" TEXT,
    CONSTRAINT "InstanceState_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstanceState_librarySnapshotId_libraryPackageVersionId_fkey" FOREIGN KEY ("librarySnapshotId", "libraryPackageVersionId") REFERENCES "LibrarySnapshotVersion" ("snapshotId", "libraryPackageVersionId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InstanceState" ("currentResourceCount", "dependencyOutputHash", "exportedArtifactIds", "hasResourceHooks", "id", "inputHash", "inputHashNonce", "instanceId", "kind", "model", "outputHash", "parentId", "resolvedInputs", "selfHash", "source", "status", "statusFields") SELECT "currentResourceCount", "dependencyOutputHash", "exportedArtifactIds", "hasResourceHooks", "id", "inputHash", "inputHashNonce", "instanceId", "kind", "model", "outputHash", "parentId", "resolvedInputs", "selfHash", "source", "status", "statusFields" FROM "InstanceState";
DROP TABLE "InstanceState";
ALTER TABLE "new_InstanceState" RENAME TO "InstanceState";
CREATE UNIQUE INDEX "InstanceState_instanceId_key" ON "InstanceState"("instanceId");
CREATE TABLE "new_Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "options" JSONB NOT NULL,
    "requestedInstanceIds" JSONB NOT NULL,
    "phases" JSONB,
    "librarySnapshotId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    CONSTRAINT "Operation_librarySnapshotId_fkey" FOREIGN KEY ("librarySnapshotId") REFERENCES "LibrarySnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Operation" ("finishedAt", "id", "meta", "options", "phases", "requestedInstanceIds", "startedAt", "status", "type", "updatedAt") SELECT "finishedAt", "id", "meta", "options", "phases", "requestedInstanceIds", "startedAt", "status", "type", "updatedAt" FROM "Operation";
DROP TABLE "Operation";
ALTER TABLE "new_Operation" RENAME TO "Operation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPackageVersion_packageName_version_packageIntegrity_key" ON "LibraryPackageVersion"("packageName", "version", "packageIntegrity");

-- CreateIndex
CREATE UNIQUE INDEX "LibrarySnapshot_hash_key" ON "LibrarySnapshot"("hash");

-- CreateIndex
CREATE INDEX "LibrarySnapshotVersion_libraryPackageVersionId_idx" ON "LibrarySnapshotVersion"("libraryPackageVersionId");
