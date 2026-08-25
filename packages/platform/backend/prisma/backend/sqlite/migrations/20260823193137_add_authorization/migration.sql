-- CreateTable
CREATE TABLE "BackendApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL DEFAULT '',
    "restrictionRules" JSONB NOT NULL DEFAULT [],
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BackendApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "BackendServiceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackendRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "systemName" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "userId"),
    CONSTRAINT "UserBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBackendRoleBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserGroupBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "groupId"),
    CONSTRAINT "UserGroupBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGroupBackendRoleBinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceAccountBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "serviceAccountId"),
    CONSTRAINT "ServiceAccountBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceAccountBackendRoleBinding_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "BackendServiceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackendServiceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "systemName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BackendServiceAccountProjectBinding" (
    "backendServiceAccountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectServiceAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("backendServiceAccountId", "projectId"),
    CONSTRAINT "BackendServiceAccountProjectBinding_backendServiceAccountId_fkey" FOREIGN KEY ("backendServiceAccountId") REFERENCES "BackendServiceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BackendServiceAccountProjectBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserWorkspaceLayout" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "layout" JSONB NOT NULL,
    CONSTRAINT "UserWorkspaceLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE "UserWorkspaceLayout";
ALTER TABLE "new_UserWorkspaceLayout" RENAME TO "UserWorkspaceLayout";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BackendApiKey_serviceAccountId_idx" ON "BackendApiKey"("serviceAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BackendRole_systemName_key" ON "BackendRole"("systemName");

-- CreateIndex
CREATE INDEX "UserBackendRoleBinding_userId_idx" ON "UserBackendRoleBinding"("userId");

-- CreateIndex
CREATE INDEX "UserGroupBackendRoleBinding_groupId_idx" ON "UserGroupBackendRoleBinding"("groupId");

-- CreateIndex
CREATE INDEX "ServiceAccountBackendRoleBinding_serviceAccountId_idx" ON "ServiceAccountBackendRoleBinding"("serviceAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BackendServiceAccount_systemName_key" ON "BackendServiceAccount"("systemName");

-- CreateIndex
CREATE INDEX "BackendServiceAccountProjectBinding_projectId_idx" ON "BackendServiceAccountProjectBinding"("projectId");
