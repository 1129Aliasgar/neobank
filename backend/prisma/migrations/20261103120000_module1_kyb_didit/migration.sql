-- Module 1: business onboarding + Didit KYB.
--
-- Enum changes are value renames/additions, not type drops: an existing
-- membership or verification row must survive the deploy.

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('LLC', 'CORPORATION', 'PARTNERSHIP', 'SOLE_PROPRIETORSHIP');

-- CreateEnum
CREATE TYPE "VerificationEnvironment" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('DIDIT', 'STRIPE');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'AGENT');

-- AlterEnum
ALTER TYPE "BusinessStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "MembershipStatus" RENAME VALUE 'REMOVED' TO 'DISABLED';

-- AlterEnum
ALTER TYPE "VerificationProvider" ADD VALUE 'DIDIT';

-- AlterEnum
ALTER TYPE "VerificationStatus" RENAME VALUE 'ON_HOLD' TO 'REVIEW';

-- DropIndex
DROP INDEX "Verification_providerApplicantId_key";

-- AlterTable
ALTER TABLE "Business" DROP COLUMN "taxId",
ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "businessType" "BusinessType",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" CHAR(2),
ADD COLUMN     "website" TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "BusinessMember" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Verification" DROP COLUMN "levelName",
DROP COLUMN "providerApplicantId",
DROP COLUMN "providerData",
ADD COLUMN     "actionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "environment" "VerificationEnvironment" NOT NULL DEFAULT 'SANDBOX',
ADD COLUMN     "lastSyncedAt" TIMESTAMPTZ(3),
ADD COLUMN     "providerSessionId" TEXT,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "reviewResult" JSONB,
ADD COLUMN     "sandboxScenario" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "workflowId" TEXT,
ALTER COLUMN "provider" SET DEFAULT 'DIDIT',
ALTER COLUMN "reviewedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "businessId" TEXT,
    "resourceId" TEXT,
    "payload" JSONB NOT NULL,
    "providerCreatedAt" TIMESTAMPTZ(3),
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_receivedAt_idx" ON "WebhookEvent"("provider", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_businessId_receivedAt_idx" ON "WebhookEvent"("businessId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_providerSessionId_key" ON "Verification"("providerSessionId");

-- CreateIndex
-- One active attempt per business. Prisma cannot express a partial index, and
-- a plain @@unique would forbid the retry history the module needs.
CREATE UNIQUE INDEX "Verification_one_active_per_business"
ON "Verification" ("businessId")
WHERE "status" IN ('NOT_STARTED', 'PENDING', 'REVIEW');

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
