/*
  Warnings:

  - A unique constraint covering the columns `[systemName]` on the table `ContainerRuntime` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[systemName]` on the table `PulumiStateBackend` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ContainerRuntime" ADD COLUMN "legacyOwnershipLabel" TEXT;
ALTER TABLE "ContainerRuntime" ADD COLUMN "systemName" TEXT;

-- AlterTable
ALTER TABLE "PulumiStateBackend" ADD COLUMN "legacyStateVolumeSuffix" TEXT;
ALTER TABLE "PulumiStateBackend" ADD COLUMN "systemName" TEXT;

UPDATE "ContainerRuntime" SET "systemName" = 'local' WHERE "id" = 'local';
UPDATE "PulumiStateBackend" SET "systemName" = 'local' WHERE "id" = 'local';

-- CreateIndex
CREATE UNIQUE INDEX "ContainerRuntime_systemName_key" ON "ContainerRuntime"("systemName");

-- CreateIndex
CREATE UNIQUE INDEX "PulumiStateBackend_systemName_key" ON "PulumiStateBackend"("systemName");
