-- Modules 4 (follow-up): store the Lithic account token.
--
-- Current Lithic cards are created with `account_token`, not a cardholder
-- token. The account token is returned by `POST /account_holders` and is
-- distinct from the account holder token already stored in
-- `providerCardholderId`.

ALTER TABLE "Cardholder" ADD COLUMN "providerAccountId" TEXT;

CREATE INDEX "Cardholder_providerAccountId_idx" ON "Cardholder"("providerAccountId");
