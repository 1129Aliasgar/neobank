-- The dev-only simulator is recorded as its own provider.
--
-- Without this, a simulated approval would be indistinguishable in the database
-- from a Didit sandbox approval, which is exactly the confusion the
-- `environment` column exists to prevent.
ALTER TYPE "VerificationProvider" ADD VALUE IF NOT EXISTS 'SIMULATOR';
