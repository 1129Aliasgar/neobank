-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "approvalThresholdMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "requireSeparateApprover" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "accountId" TEXT,
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryReference" TEXT,
    "memo" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalThresholdMinor" BIGINT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "approvalsCount" INTEGER NOT NULL DEFAULT 0,
    "decisionByUserId" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "ledgerTransactionId" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_businessId_status_idx" ON "Invitation"("businessId", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_ledgerTransactionId_key" ON "PaymentRequest"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentRequest_businessId_status_createdAt_idx" ON "PaymentRequest"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_businessId_createdByUserId_createdAt_idx" ON "PaymentRequest"("businessId", "createdByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_businessId_idempotencyKey_key" ON "PaymentRequest"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Approval_businessId_createdAt_idx" ON "Approval"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_paymentRequestId_actorUserId_key" ON "Approval"("paymentRequestId", "actorUserId");

-- One live invitation per (business, email), case-insensitive.
-- A resend rotates the existing row instead of leaving two live tokens.
CREATE UNIQUE INDEX "Invitation_business_email_pending_key"
  ON "Invitation" ("businessId", lower("email"))
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_decisionByUserId_fkey" FOREIGN KEY ("decisionByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money invariants. The application checks these too; the database is the
-- final guard when two writers race or a future code path forgets.
ALTER TABLE "Business"
  ADD CONSTRAINT "Business_approvalThresholdMinor_nonnegative"
  CHECK ("approvalThresholdMinor" >= 0);

ALTER TABLE "PaymentRequest"
  ADD CONSTRAINT "PaymentRequest_amount_positive"
  CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "PaymentRequest_threshold_nonnegative"
  CHECK ("approvalThresholdMinor" >= 0),
  ADD CONSTRAINT "PaymentRequest_approvals_valid"
  CHECK ("approvalsCount" >= 0 AND "requiredApprovals" >= 1),
  ADD CONSTRAINT "PaymentRequest_currency_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');
