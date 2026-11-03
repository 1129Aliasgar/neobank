CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE','FROZEN','CLOSED');
CREATE TYPE "LedgerEnvironment" AS ENUM ('SANDBOX','LIVE');
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT','CREDIT');
CREATE TYPE "LedgerTransactionKind" AS ENUM ('DEPOSIT','CARD_CAPTURE','CARD_REFUND','PAYMENT','PAYMENT_RETURN','FEE','REVERSAL','ADJUSTMENT');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('POSTED','REVERSED');
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE','CAPTURED','RELEASED','EXPIRED');
CREATE TYPE "HoldSource" AS ENUM ('CARD_AUTHORIZATION','PAYMENT_REQUEST','SANDBOX');

CREATE TABLE "Account" (
  "id" TEXT NOT NULL, "businessId" TEXT NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE', "environment" "LedgerEnvironment" NOT NULL DEFAULT 'SANDBOX',
  "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "frozenAt" TIMESTAMPTZ(3), "closedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LedgerAccount" (
  "id" TEXT NOT NULL, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "type" "LedgerAccountType" NOT NULL, "currency" CHAR(3) NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LedgerTransaction" (
  "id" TEXT NOT NULL, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "kind" "LedgerTransactionKind" NOT NULL,
  "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'POSTED', "currency" CHAR(3) NOT NULL, "amountMinor" BIGINT NOT NULL,
  "description" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "sourceType" TEXT NOT NULL,
  "sourceId" TEXT, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "postedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "environment" "LedgerEnvironment" NOT NULL DEFAULT 'SANDBOX', "reversesTransactionId" TEXT, "createdByUserId" TEXT,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "ledgerAccountId" TEXT NOT NULL, "direction" "LedgerDirection" NOT NULL,
  "amountMinor" BIGINT NOT NULL, "currency" CHAR(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Hold" (
  "id" TEXT NOT NULL, "businessId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "amountMinor" BIGINT NOT NULL,
  "capturedMinor" BIGINT NOT NULL DEFAULT 0, "currency" CHAR(3) NOT NULL, "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "HoldSource" NOT NULL, "sourceId" TEXT, "idempotencyKey" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "capturedAt" TIMESTAMPTZ(3), "releasedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Account" ADD CONSTRAINT "Account_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reverses_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Account_businessId_currency_key" ON "Account"("businessId","currency");
CREATE UNIQUE INDEX "LedgerAccount_accountId_code_key" ON "LedgerAccount"("accountId","code");
CREATE UNIQUE INDEX "LedgerTransaction_businessId_idempotencyKey_key" ON "LedgerTransaction"("businessId","idempotencyKey");
CREATE UNIQUE INDEX "LedgerTransaction_reversesTransactionId_key" ON "LedgerTransaction"("reversesTransactionId");
CREATE UNIQUE INDEX "LedgerEntry_transactionId_ledgerAccountId_direction_key" ON "LedgerEntry"("transactionId","ledgerAccountId","direction");
CREATE UNIQUE INDEX "Hold_businessId_idempotencyKey_key" ON "Hold"("businessId","idempotencyKey");
CREATE UNIQUE INDEX "Hold_source_sourceId_key" ON "Hold"("source","sourceId");
CREATE INDEX "Account_status_openedAt_idx" ON "Account"("status","openedAt");
CREATE INDEX "LedgerAccount_businessId_code_idx" ON "LedgerAccount"("businessId","code");
CREATE INDEX "LedgerTransaction_accountId_postedAt_id_idx" ON "LedgerTransaction"("accountId","postedAt","id");
CREATE INDEX "LedgerTransaction_businessId_kind_postedAt_idx" ON "LedgerTransaction"("businessId","kind","postedAt");
CREATE INDEX "LedgerEntry_ledgerAccountId_createdAt_idx" ON "LedgerEntry"("ledgerAccountId","createdAt");
CREATE INDEX "Hold_accountId_status_expiresAt_idx" ON "Hold"("accountId","status","expiresAt");
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_captured_within_amount" CHECK ("capturedMinor" >= 0 AND "capturedMinor" <= "amountMinor");

CREATE OR REPLACE FUNCTION "LedgerEntry_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LedgerEntry is append-only (attempted %)', TG_OP; END; $$;
CREATE TRIGGER "LedgerEntry_no_mutation" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION "LedgerEntry_immutable"();
CREATE TRIGGER "LedgerEntry_no_truncate" BEFORE TRUNCATE ON "LedgerEntry" FOR EACH STATEMENT EXECUTE FUNCTION "LedgerEntry_immutable"();
CREATE OR REPLACE FUNCTION "LedgerTransaction_guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LedgerTransaction cannot be deleted'; END IF; IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."currency" <> OLD."currency" OR NEW."kind" <> OLD."kind" OR NEW."accountId" <> OLD."accountId" OR NEW."businessId" <> OLD."businessId" OR NEW."postedAt" <> OLD."postedAt" OR NEW."occurredAt" <> OLD."occurredAt" OR NEW."idempotencyKey" <> OLD."idempotencyKey" THEN RAISE EXCEPTION 'LedgerTransaction money fields are immutable'; END IF; IF OLD."status" = 'REVERSED' AND NEW."status" <> 'REVERSED' THEN RAISE EXCEPTION 'REVERSED is terminal'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "LedgerTransaction_guard" BEFORE UPDATE OR DELETE ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION "LedgerTransaction_guard"();
CREATE OR REPLACE FUNCTION "assert_transaction_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE d bigint; c bigint; n int; h bigint; BEGIN SELECT COALESCE(SUM(CASE WHEN "direction"='DEBIT' THEN "amountMinor" END),0),COALESCE(SUM(CASE WHEN "direction"='CREDIT' THEN "amountMinor" END),0),COUNT(*) INTO d,c,n FROM "LedgerEntry" WHERE "transactionId"=NEW."transactionId"; SELECT "amountMinor" INTO h FROM "LedgerTransaction" WHERE "id"=NEW."transactionId"; IF n < 2 THEN RAISE EXCEPTION 'ledger transaction % has % entries',NEW."transactionId",n; END IF; IF d <> c THEN RAISE EXCEPTION 'ledger transaction % is unbalanced',NEW."transactionId"; END IF; IF h <> d THEN RAISE EXCEPTION 'ledger transaction % header mismatch',NEW."transactionId"; END IF; RETURN NULL; END; $$;
CREATE CONSTRAINT TRIGGER "LedgerEntry_balanced" AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_transaction_balanced"();
