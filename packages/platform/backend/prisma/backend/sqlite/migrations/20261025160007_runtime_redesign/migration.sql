-- Legacy host execution configuration is retained per project before removing the old tables.

-- CreateTable
CREATE TABLE "LibrarySnapshotImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "runtimeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "progress" JSONB,
    "workloadId" TEXT,
    "imageRef" TEXT,
    "imageDigest" TEXT,
    "imageHash" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "LibrarySnapshotImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibrarySnapshotImage_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "ContainerRuntime" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibrarySnapshotImage_workloadId_fkey" FOREIGN KEY ("workloadId") REFERENCES "RuntimeWorkload" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PulumiStateBackend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NpmRegistryCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "registryUrl" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContainerRegistryCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "registryUrl" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContainerRuntime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

INSERT INTO "ContainerRuntime" ("id", "meta", "spec", "updatedAt") VALUES
('local', '{"title":"Local Docker","description":"Runs project workloads on the local Docker engine."}',
 '{"type":"docker","local":true,"engineEndpoint":"unix:///var/run/docker.sock","runtimeApiUrl":"https://host.docker.internal:3000"}', CURRENT_TIMESTAMP);

-- The old host login may point at any Pulumi backend. Do not silently redirect its stacks to new storage.
-- The explicit legacy URL requires operator selection of the original state URL before container execution.
INSERT INTO "PulumiStateBackend" ("id", "meta", "spec", "updatedAt")
SELECT "id", "meta", json_object('url', 'legacy:host'), CURRENT_TIMESTAMP FROM "PulumiBackend";

INSERT INTO "PulumiStateBackend" ("id", "meta", "spec", "updatedAt") VALUES
('local', '{"title":"Local Pulumi State","description":"Stores Pulumi state in the runtime persistent local state directory."}',
 '{"url":"file://~"}', CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "RuntimeWorkload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runtimeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "nativeResourceId" TEXT,
    "desiredState" TEXT NOT NULL DEFAULT 'running',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leaseGeneration" INTEGER NOT NULL DEFAULT 1,
    "leaseExpiresAt" DATETIME,
    "connectedAt" DATETIME,
    "finishedAt" DATETIME,
    "cleanupStartedAt" DATETIME,
    "cleanedUpAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeWorkload_runtimeId_fkey" FOREIGN KEY ("runtimeId") REFERENCES "ContainerRuntime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RuntimeWorkload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RuntimeAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workloadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "imageDigest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cancellationRequestedAt" DATETIME,
    "forceCancellationRequestedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeAction_workloadId_fkey" FOREIGN KEY ("workloadId") REFERENCES "RuntimeWorkload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ContainerRegistryCredentialToContainerRuntime" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ContainerRegistryCredentialToContainerRuntime_A_fkey" FOREIGN KEY ("A") REFERENCES "ContainerRegistryCredential" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ContainerRegistryCredentialToContainerRuntime_B_fkey" FOREIGN KEY ("B") REFERENCES "ContainerRuntime" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ContainerRuntimeToNpmRegistryCredential" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ContainerRuntimeToNpmRegistryCredential_A_fkey" FOREIGN KEY ("A") REFERENCES "ContainerRuntime" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ContainerRuntimeToNpmRegistryCredential_B_fkey" FOREIGN KEY ("B") REFERENCES "NpmRegistryCredential" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "modelStorageId" TEXT NOT NULL,
    "containerRuntimeId" TEXT NOT NULL,
    "pulumiStateBackendId" TEXT NOT NULL,
    "legacyExecutionConfig" JSONB,
    "encryptedMasterKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT,
    "publicKey" TEXT,
    "unlockSuite" JSONB NOT NULL,
    "databaseVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ProjectSpace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_modelStorageId_fkey" FOREIGN KEY ("modelStorageId") REFERENCES "ProjectModelStorage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_containerRuntimeId_fkey" FOREIGN KEY ("containerRuntimeId") REFERENCES "ContainerRuntime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_pulumiStateBackendId_fkey" FOREIGN KEY ("pulumiStateBackendId") REFERENCES "PulumiStateBackend" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "databaseVersion", "encryptedMasterKey", "encryptedPrivateKey", "id", "meta", "modelStorageId", "name", "publicKey", "spaceId", "unlockSuite", "updatedAt", "containerRuntimeId", "pulumiStateBackendId", "legacyExecutionConfig")
SELECT p."createdAt", p."databaseVersion", p."encryptedMasterKey", p."encryptedPrivateKey", p."id", p."meta", p."modelStorageId", p."name", p."publicKey", p."spaceId", p."unlockSuite", p."updatedAt", 'local', p."pulumiBackendId",
json_object('libraryId', p."libraryId", 'pulumiBackendId', p."pulumiBackendId", 'librarySpec', json(l."spec"), 'libraryMeta', json(l."meta"), 'pulumiBackendSpec', json(b."spec"), 'pulumiBackendMeta', json(b."meta"))
FROM "Project" p JOIN "Library" l ON l."id" = p."libraryId" JOIN "PulumiBackend" b ON b."id" = p."pulumiBackendId";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
DROP TABLE "Library";
DROP TABLE "PulumiBackend";
CREATE UNIQUE INDEX "Project_spaceId_name_key" ON "Project"("spaceId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "LibrarySnapshotImage_workloadId_key" ON "LibrarySnapshotImage"("workloadId");

-- CreateIndex
CREATE INDEX "LibrarySnapshotImage_runtimeId_status_idx" ON "LibrarySnapshotImage"("runtimeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LibrarySnapshotImage_projectId_snapshotId_runtimeId_key" ON "LibrarySnapshotImage"("projectId", "snapshotId", "runtimeId");

-- CreateIndex
CREATE UNIQUE INDEX "NpmRegistryCredential_scope_key" ON "NpmRegistryCredential"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "ContainerRegistryCredential_registryUrl_key" ON "ContainerRegistryCredential"("registryUrl");

-- CreateIndex
CREATE INDEX "RuntimeWorkload_projectId_kind_status_idx" ON "RuntimeWorkload"("projectId", "kind", "status");

-- CreateIndex
CREATE INDEX "RuntimeWorkload_runtimeId_desiredState_status_idx" ON "RuntimeWorkload"("runtimeId", "desiredState", "status");

-- CreateIndex
CREATE INDEX "RuntimeWorkload_leaseExpiresAt_idx" ON "RuntimeWorkload"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeWorkload_runtimeId_nativeResourceId_key" ON "RuntimeWorkload"("runtimeId", "nativeResourceId");

-- CreateIndex
CREATE INDEX "RuntimeAction_workloadId_status_idx" ON "RuntimeAction"("workloadId", "status");

-- CreateIndex
CREATE INDEX "RuntimeAction_ownerId_kind_idx" ON "RuntimeAction"("ownerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "_ContainerRegistryCredentialToContainerRuntime_AB_unique" ON "_ContainerRegistryCredentialToContainerRuntime"("A", "B");

-- CreateIndex
CREATE INDEX "_ContainerRegistryCredentialToContainerRuntime_B_index" ON "_ContainerRegistryCredentialToContainerRuntime"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ContainerRuntimeToNpmRegistryCredential_AB_unique" ON "_ContainerRuntimeToNpmRegistryCredential"("A", "B");

-- CreateIndex
CREATE INDEX "_ContainerRuntimeToNpmRegistryCredential_B_index" ON "_ContainerRuntimeToNpmRegistryCredential"("B");
