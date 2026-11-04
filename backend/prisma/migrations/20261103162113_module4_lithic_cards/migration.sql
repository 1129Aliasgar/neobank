-- CreateEnum
CREATE TYPE "CardProvider" AS ENUM ('LITHIC');

-- CreateEnum
CREATE TYPE "CardholderStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'REQUIREMENTS_PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('VIRTUAL', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "CardAuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CardTransactionKind" AS ENUM ('AUTHORIZATION', 'CAPTURE', 'VOID', 'REFUND', 'REVERSAL');

-- AlterEnum
ALTER TYPE "WebhookProvider" ADD VALUE 'LITHIC';

-- CreateTable
CREATE TABLE "Cardholder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CardProvider" NOT NULL DEFAULT 'LITHIC',
    "providerCardholderId" TEXT NOT NULL,
    "status" "CardholderStatus" NOT NULL DEFAULT 'PENDING',
    "providerRequirements" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Cardholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "cardholderId" TEXT NOT NULL,
    "provider" "CardProvider" NOT NULL DEFAULT 'LITHIC',
    "providerCardId" TEXT NOT NULL,
    "type" "CardType" NOT NULL DEFAULT 'VIRTUAL',
    "status" "CardStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "last4" TEXT,
    "brand" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "spendingLimitMinor" BIGINT,
    "spendingLimitInterval" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAuthorization" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "providerAuthorizationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "capturedMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "CardAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "merchantName" TEXT,
    "merchantMcc" TEXT,
    "providerCreatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CardAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "authorizationId" TEXT,
    "providerTransactionId" TEXT NOT NULL,
    "kind" "CardTransactionKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cardholder_providerCardholderId_key" ON "Cardholder"("providerCardholderId");

-- CreateIndex
CREATE INDEX "Cardholder_businessId_status_idx" ON "Cardholder"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Cardholder_businessId_userId_provider_key" ON "Cardholder"("businessId", "userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Card_providerCardId_key" ON "Card"("providerCardId");

-- CreateIndex
CREATE INDEX "Card_businessId_status_idx" ON "Card"("businessId", "status");

-- CreateIndex
CREATE INDEX "Card_cardholderId_status_idx" ON "Card"("cardholderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardAuthorization_providerAuthorizationId_key" ON "CardAuthorization"("providerAuthorizationId");

-- CreateIndex
CREATE INDEX "CardAuthorization_businessId_status_createdAt_idx" ON "CardAuthorization"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CardAuthorization_accountId_status_idx" ON "CardAuthorization"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardTransaction_providerTransactionId_key" ON "CardTransaction"("providerTransactionId");

-- CreateIndex
CREATE INDEX "CardTransaction_businessId_occurredAt_idx" ON "CardTransaction"("businessId", "occurredAt");

-- CreateIndex
CREATE INDEX "CardTransaction_authorizationId_idx" ON "CardTransaction"("authorizationId");

-- AddForeignKey
ALTER TABLE "Cardholder" ADD CONSTRAINT "Cardholder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cardholder" ADD CONSTRAINT "Cardholder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_cardholderId_fkey" FOREIGN KEY ("cardholderId") REFERENCES "Cardholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "CardAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
