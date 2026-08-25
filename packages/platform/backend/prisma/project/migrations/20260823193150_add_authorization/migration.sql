/*
  Warnings:

  - You are about to drop the column `token` on the `ApiKey` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[systemName]` on the table `ServiceAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ServiceAccount" ADD COLUMN "systemName" TEXT;

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "systemName" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserRoleBinding" (
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "userId"),
    CONSTRAINT "UserRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRoleBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserGroupRoleBinding" (
    "roleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "groupId"),
    CONSTRAINT "UserGroupRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGroupRoleBinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceAccountRoleBinding" (
    "roleId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("roleId", "serviceAccountId"),
    CONSTRAINT "ServiceAccountRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceAccountRoleBinding_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE TABLE "new_ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL DEFAULT '',
    "restrictionRules" JSONB NOT NULL DEFAULT [],
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
DROP TABLE "ApiKey";
ALTER TABLE "new_ApiKey" RENAME TO "ApiKey";
CREATE TABLE "new_UserCompositeViewport" (
    "userId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "viewport" JSONB NOT NULL,

    PRIMARY KEY ("userId", "stateId"),
    CONSTRAINT "UserCompositeViewport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCompositeViewport_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
DROP TABLE "UserCompositeViewport";
ALTER TABLE "new_UserCompositeViewport" RENAME TO "UserCompositeViewport";
CREATE TABLE "new_UserProjectViewport" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "viewport" JSONB NOT NULL,
    CONSTRAINT "UserProjectViewport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE "UserProjectViewport";
ALTER TABLE "new_UserProjectViewport" RENAME TO "UserProjectViewport";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Role_systemName_key" ON "Role"("systemName");

-- CreateIndex
CREATE INDEX "UserRoleBinding_userId_idx" ON "UserRoleBinding"("userId");

-- CreateIndex
CREATE INDEX "UserGroupRoleBinding_groupId_idx" ON "UserGroupRoleBinding"("groupId");

-- CreateIndex
CREATE INDEX "ServiceAccountRoleBinding_serviceAccountId_idx" ON "ServiceAccountRoleBinding"("serviceAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAccount_systemName_key" ON "ServiceAccount"("systemName");
