-- CreateTable
CREATE TABLE "DesignerSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "DesignerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignerLoginTransaction" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DesignerAuthInitialization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DesignerSession_userId_idx" ON "DesignerSession"("userId");

-- CreateIndex
CREATE INDEX "DesignerSession_expiresAt_idx" ON "DesignerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DesignerLoginTransaction_expiresAt_idx" ON "DesignerLoginTransaction"("expiresAt");
