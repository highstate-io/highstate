-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "identity" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EntitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "referencedInOutputs" JSONB NOT NULL,
    "exportedInOutputs" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntitySnapshot_contentHash_fkey" FOREIGN KEY ("contentHash") REFERENCES "EntitySnapshotContent" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshot_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshot_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntitySnapshotReference" (
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "group" TEXT NOT NULL,

    PRIMARY KEY ("fromId", "toId", "kind", "group"),
    CONSTRAINT "EntitySnapshotReference_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "EntitySnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshotReference_toId_fkey" FOREIGN KEY ("toId") REFERENCES "EntitySnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntitySnapshotContent" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB,
    "content" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "_ArtifactToEntitySnapshot" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArtifactToEntitySnapshot_A_fkey" FOREIGN KEY ("A") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArtifactToEntitySnapshot_B_fkey" FOREIGN KEY ("B") REFERENCES "EntitySnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EntitySnapshot_entityId_createdAt_idx" ON "EntitySnapshot"("entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EntitySnapshot_operationId_idx" ON "EntitySnapshot"("operationId");

-- CreateIndex
CREATE INDEX "EntitySnapshot_stateId_createdAt_idx" ON "EntitySnapshot"("stateId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EntitySnapshotReference_toId_idx" ON "EntitySnapshotReference"("toId");

-- CreateIndex
CREATE INDEX "EntitySnapshotReference_fromId_idx" ON "EntitySnapshotReference"("fromId");

-- CreateIndex
CREATE UNIQUE INDEX "_ArtifactToEntitySnapshot_AB_unique" ON "_ArtifactToEntitySnapshot"("A", "B");

-- CreateIndex
CREATE INDEX "_ArtifactToEntitySnapshot_B_index" ON "_ArtifactToEntitySnapshot"("B");
