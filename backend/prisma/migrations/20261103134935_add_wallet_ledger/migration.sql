-- AlterTable
ALTER TABLE "Hold" ALTER COLUMN "capturedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "releasedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LedgerTransaction_sourceType_sourceId_idx" ON "LedgerTransaction"("sourceType", "sourceId");

-- RenameForeignKey
ALTER TABLE "LedgerTransaction" RENAME CONSTRAINT "LedgerTransaction_reverses_fkey" TO "LedgerTransaction_reversesTransactionId_fkey";
