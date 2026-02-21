-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "identity" TEXT
);

-- CreateTable
CREATE TABLE "EntitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "entityId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntitySnapshot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshot_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshot_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "InstanceState" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntitySnapshotReference" (
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,

    PRIMARY KEY ("fromId", "toId"),
    CONSTRAINT "EntitySnapshotReference_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "EntitySnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntitySnapshotReference_toId_fkey" FOREIGN KEY ("toId") REFERENCES "EntitySnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
