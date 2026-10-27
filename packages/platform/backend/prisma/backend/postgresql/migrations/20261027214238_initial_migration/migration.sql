-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('local', 'oidc', 'oauth');

-- CreateTable
CREATE TABLE "BackendApiKey" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL DEFAULT '',
    "restrictionRules" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignerSession" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DesignerSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "DesignerLoginTransaction" (
    "tokenHash" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerLoginTransaction_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "ProjectImportPort" (
    "projectId" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "sourceStateId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "encryptedContent" TEXT NOT NULL,

    CONSTRAINT "ProjectImportPort_pkey" PRIMARY KEY ("projectId","sourceStateId")
);

-- CreateTable
CREATE TABLE "UserWorkspaceLayout" (
    "userId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,

    CONSTRAINT "UserWorkspaceLayout_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Library" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL,

    CONSTRAINT "Library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Object" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "Object_pkey" PRIMARY KEY ("id","projectId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "modelStorageId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "pulumiBackendId" TEXT NOT NULL,
    "encryptedMasterKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT,
    "publicKey" TEXT,
    "unlockSuite" JSONB NOT NULL,
    "databaseVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "parentId" TEXT,
    "meta" JSONB NOT NULL,

    CONSTRAINT "ProjectSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectModelStorage" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL,

    CONSTRAINT "ProjectModelStorage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulumiBackend" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "spec" JSONB NOT NULL,

    CONSTRAINT "PulumiBackend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackendRole" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "systemName" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBackendRoleBinding_pkey" PRIMARY KEY ("roleId","userId")
);

-- CreateTable
CREATE TABLE "UserGroupBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupBackendRoleBinding_pkey" PRIMARY KEY ("roleId","groupId")
);

-- CreateTable
CREATE TABLE "ServiceAccountBackendRoleBinding" (
    "roleId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAccountBackendRoleBinding_pkey" PRIMARY KEY ("roleId","serviceAccountId")
);

-- CreateTable
CREATE TABLE "BackendServiceAccount" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "systemName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendServiceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackendServiceAccountProjectBinding" (
    "backendServiceAccountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectServiceAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackendServiceAccountProjectBinding_pkey" PRIMARY KEY ("backendServiceAccountId","projectId")
);

-- CreateTable
CREATE TABLE "BackendUnlockMethod" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "recipient" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendUnlockMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "meta" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackendApiKey_serviceAccountId_idx" ON "BackendApiKey"("serviceAccountId");

-- CreateIndex
CREATE INDEX "DesignerSession_userId_idx" ON "DesignerSession"("userId");

-- CreateIndex
CREATE INDEX "DesignerSession_expiresAt_idx" ON "DesignerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DesignerLoginTransaction_expiresAt_idx" ON "DesignerLoginTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "ProjectImportPort_sourceProjectId_sourceStateId_idx" ON "ProjectImportPort"("sourceProjectId", "sourceStateId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_spaceId_name_key" ON "Project"("spaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSpace_parentId_name_key" ON "ProjectSpace"("parentId", "name");

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

-- CreateIndex
CREATE UNIQUE INDEX "BackendUnlockMethod_recipient_key" ON "BackendUnlockMethod"("recipient");

-- AddForeignKey
ALTER TABLE "BackendApiKey" ADD CONSTRAINT "BackendApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "BackendServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerSession" ADD CONSTRAINT "DesignerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImportPort" ADD CONSTRAINT "ProjectImportPort_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImportPort" ADD CONSTRAINT "ProjectImportPort_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorkspaceLayout" ADD CONSTRAINT "UserWorkspaceLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ProjectSpace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_modelStorageId_fkey" FOREIGN KEY ("modelStorageId") REFERENCES "ProjectModelStorage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_pulumiBackendId_fkey" FOREIGN KEY ("pulumiBackendId") REFERENCES "PulumiBackend"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSpace" ADD CONSTRAINT "ProjectSpace_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBackendRoleBinding" ADD CONSTRAINT "UserBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBackendRoleBinding" ADD CONSTRAINT "UserBackendRoleBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupBackendRoleBinding" ADD CONSTRAINT "UserGroupBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupBackendRoleBinding" ADD CONSTRAINT "UserGroupBackendRoleBinding_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAccountBackendRoleBinding" ADD CONSTRAINT "ServiceAccountBackendRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "BackendRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAccountBackendRoleBinding" ADD CONSTRAINT "ServiceAccountBackendRoleBinding_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "BackendServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackendServiceAccountProjectBinding" ADD CONSTRAINT "BackendServiceAccountProjectBinding_backendServiceAccountI_fkey" FOREIGN KEY ("backendServiceAccountId") REFERENCES "BackendServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackendServiceAccountProjectBinding" ADD CONSTRAINT "BackendServiceAccountProjectBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
