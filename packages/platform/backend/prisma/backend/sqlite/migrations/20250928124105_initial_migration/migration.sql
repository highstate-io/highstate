-- CreateTable
CREATE TABLE "UserWorkspaceLayout" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "layout" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "Library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "modelStorageId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "pulumiBackendId" TEXT NOT NULL,
    "encryptedMasterKey" TEXT NOT NULL,
    "unlockSuite" JSONB NOT NULL,
    "databaseVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ProjectSpace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_modelStorageId_fkey" FOREIGN KEY ("modelStorageId") REFERENCES "ProjectModelStorage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_pulumiBackendId_fkey" FOREIGN KEY ("pulumiBackendId") REFERENCES "PulumiBackend" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectSpace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "parentId" TEXT,
    "meta" JSONB NOT NULL,
    CONSTRAINT "ProjectSpace_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectSpace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectModelStorage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "PulumiBackend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "BackendUnlockMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "recipient" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_spaceId_name_key" ON "Project"("spaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSpace_parentId_name_key" ON "ProjectSpace"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BackendUnlockMethod_recipient_key" ON "BackendUnlockMethod"("recipient");
