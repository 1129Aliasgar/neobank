# NeoBank

NeoBank is a deliberately narrow US business-banking prototype for the Corgi Track 3 trial. It demonstrates the high-risk financial loop instead of pretending that a two-day build is a complete bank:

```text
KYB-approved business → USD account → card authorization/hold
→ different-amount settlement → immutable ledger
→ human-approved outbound payment → reconciliation/MCP next
```

The backend owns authorization, tenancy, money, idempotency and audit history. The browser never writes a balance or ledger entry.

## Current implementation

| Module | Status | What exists |
| --- | --- | --- |
| 1. Business onboarding | Complete | Registration, profile, Didit Sandbox KYB, signed/idempotent webhooks and onboarding gates |
| 2. Role dashboard | Complete | Owner/admin/employee views, tenant-aware shell and role navigation |
| 3. Account + ledger | Complete | USD integer-cents balances, holds, immutable double-entry journals, reversals and integrity checks |
| 4. Card issuing | Complete locally | Lithic Sandbox cardholders/cards, signed webhooks, authorization holds, partial/different captures, voids, refunds and reversals |
| 5. Team + approvals | Complete locally | Invitations, roles, threshold policy, payment requests, maker-checker approvals and simulator rail |
| 6. Statements + reconciliation + operations | Next | Specified, not implemented |
| 7. MCP agent surface | Next | Specified with Module 6, not implemented |

The scope is intentionally seven small modules because the assignment is a 48-hour trial. We prioritized the domain mechanics that are explicitly graded: append-only money, holds, settlement asymmetry, signed webhooks, idempotency, tenant isolation and maker-checker approval. Real ACH/bank rails, open banking, stablecoin transfers, statements, reconciliation and MCP are not hidden behind fake claims; they are the next cut after the core is stable.

## Providers and honest labels

- **Didit Sandbox — live provider integration:** verification sessions, status webhooks, signature verification and idempotent state transitions.
- **Lithic Sandbox — live provider integration in code:** virtual card creation, lifecycle controls and signed authorization/transaction event handling. Deployed event-subscription evidence still needs to be captured before calling the integration fully demonstrated in production.
- **Outbound payments — simulated:** the approval path posts NeoBank's ledger only and never claims that a bank transfer occurred.

The Corgi brief allows payment rails and open-banking funding to be live or simulated. Card issuing and KYB are the mandatory live provider slots, which is why Didit and Lithic were prioritized. Stripe Issuing was unavailable in the project region, so Lithic was selected without changing the domain model.

See the full submission rationale, rubric mapping and manual test sequence in [`SUBMISSION.md`](SUBMISSION.md).

## Quick start

Requirements: Node 22+, PostgreSQL 16+, and PowerShell/bash.

```bash
# backend
cd backend
cp .env.example .env
# set DATABASE_URL and JWT_SECRET (at least 32 characters)
npm install
npm run db:migrate:deploy
npm run db:seed
npm run dev                         # http://localhost:5000

# frontend, in another terminal
cd frontend
cp .env.example .env.local
# set NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
npm install
npm run dev                         # http://localhost:3000
```

For provider-backed card testing, set `LITHIC_API_KEY`, `LITHIC_ENABLED=true`, and the Lithic Sandbox webhook variables in `backend/.env`. Didit variables are documented in `backend/.env.example`. Never use live keys or real personal data.

Validation commands:

```bash
cd backend && npm run typecheck && npm run build
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

The reproducible local smoke matrix is:

```bash
cd backend
npm run smoke
SMOKE_TEAM_FLOW=1 npm run smoke
```

The second command mutates demo rows; run `npm run db:seed` afterward to restore the seeded state.
