-- AlterTable
ALTER TABLE "Project" ADD COLUMN "encryptedPrivateKey" TEXT;
ALTER TABLE "Project" ADD COLUMN "publicKey" TEXT;

-- CreateTable
CREATE TABLE "ProjectImportPort" (
    "projectId" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "sourceStateId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "encryptedContent" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "sourceStateId"),
    CONSTRAINT "ProjectImportPort_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectImportPort_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProjectImportPort_sourceProjectId_sourceStateId_idx" ON "ProjectImportPort"("sourceProjectId", "sourceStateId");
