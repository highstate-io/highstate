-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKey_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InstanceCustomStatus" (
    "stateId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "value" TEXT NOT NULL,
    "message" TEXT,
    "order" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("stateId", "serviceAccountId", "name"),
    CONSTRAINT "InstanceCustomStatus_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstanceCustomStatus_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstanceEvaluationState" (
    "stateId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "model" JSONB,
    "evaluatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstanceEvaluationState_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstanceState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "inputHashNonce" INTEGER,
    "inputHash" INTEGER,
    "outputHash" INTEGER,
    "dependencyOutputHash" INTEGER,
    "exportedArtifactIds" JSONB,
    "model" JSONB,
    "resolvedInputs" JSONB,
    "currentResourceCount" INTEGER,
    "statusFields" JSONB,
    CONSTRAINT "InstanceState_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProjectViewport" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "viewport" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "UserCompositeViewport" (
    "userId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "viewport" JSONB NOT NULL,

    PRIMARY KEY ("userId", "stateId"),
    CONSTRAINT "UserCompositeViewport_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstanceLock" (
    "stateId" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "token" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstanceLock_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstanceModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "model" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HubModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "model" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "options" JSONB NOT NULL,
    "requestedInstanceIds" JSONB NOT NULL,
    "phases" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "InstanceOperationState" (
    "operationId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentResourceCount" INTEGER,
    "totalResourceCount" INTEGER,
    "model" JSONB NOT NULL,
    "resolvedInputs" JSONB NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,

    PRIMARY KEY ("operationId", "stateId"),
    CONSTRAINT "InstanceOperationState_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstanceOperationState_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "stateId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    CONSTRAINT "OperationLog_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OperationLog_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "stateId" TEXT,
    "name" TEXT,
    "serviceAccountId" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Page_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Page_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Secret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "stateId" TEXT,
    "name" TEXT,
    "systemName" TEXT,
    "serviceAccountId" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Secret_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Secret_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "spec" JSONB NOT NULL,
    "stateId" TEXT,
    "name" TEXT,
    "serviceAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Terminal_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Terminal_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TerminalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "terminalId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "TerminalSession_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TerminalSessionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "TerminalSessionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TerminalSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trigger_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UnlockMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "encryptedIdentity" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Worker_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runtimeId" TEXT,
    "workerId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkerVersion_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkerVersion_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerUnitRegistration" (
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "workerVersionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("stateId", "name"),
    CONSTRAINT "WorkerUnitRegistration_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkerUnitRegistration_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerVersionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerVersionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkerVersionLog_workerVersionId_fkey" FOREIGN KEY ("workerVersionId") REFERENCES "WorkerVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ArtifactToServiceAccount" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArtifactToServiceAccount_A_fkey" FOREIGN KEY ("A") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArtifactToServiceAccount_B_fkey" FOREIGN KEY ("B") REFERENCES "ServiceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ArtifactToInstanceState" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArtifactToInstanceState_A_fkey" FOREIGN KEY ("A") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArtifactToInstanceState_B_fkey" FOREIGN KEY ("B") REFERENCES "InstanceState" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ArtifactToTerminal" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArtifactToTerminal_A_fkey" FOREIGN KEY ("A") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArtifactToTerminal_B_fkey" FOREIGN KEY ("B") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ArtifactToPage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArtifactToPage_A_fkey" FOREIGN KEY ("A") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArtifactToPage_B_fkey" FOREIGN KEY ("B") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_token_key" ON "ApiKey"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_hash_key" ON "Artifact"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceState_instanceId_key" ON "InstanceState"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_stateId_name_key" ON "Page"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Secret_systemName_key" ON "Secret"("systemName");

-- CreateIndex
CREATE UNIQUE INDEX "Secret_stateId_name_key" ON "Secret"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_stateId_name_key" ON "Terminal"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Trigger_stateId_name_key" ON "Trigger"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockMethod_recipient_key" ON "UnlockMethod"("recipient");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_identity_key" ON "Worker"("identity");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_serviceAccountId_key" ON "Worker"("serviceAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerVersion_digest_key" ON "WorkerVersion"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerVersion_apiKeyId_key" ON "WorkerVersion"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "_ArtifactToServiceAccount_AB_unique" ON "_ArtifactToServiceAccount"("A", "B");

-- CreateIndex
CREATE INDEX "_ArtifactToServiceAccount_B_index" ON "_ArtifactToServiceAccount"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ArtifactToInstanceState_AB_unique" ON "_ArtifactToInstanceState"("A", "B");

-- CreateIndex
CREATE INDEX "_ArtifactToInstanceState_B_index" ON "_ArtifactToInstanceState"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ArtifactToTerminal_AB_unique" ON "_ArtifactToTerminal"("A", "B");

-- CreateIndex
CREATE INDEX "_ArtifactToTerminal_B_index" ON "_ArtifactToTerminal"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ArtifactToPage_AB_unique" ON "_ArtifactToPage"("A", "B");

-- CreateIndex
CREATE INDEX "_ArtifactToPage_B_index" ON "_ArtifactToPage"("B");
