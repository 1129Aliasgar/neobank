# NeoBank

A small business-banking prototype: a business owner registers, completes KYB,
opens a wallet, gets an immutable double-entry ledger, and issues Lithic
Sandbox virtual cards to employees. Money movement is driven by signed provider
webhooks, never by trusting the browser.

**Stack:** Node 22 + Express + TypeScript + Prisma + PostgreSQL (Neon) +
Inversify, Next.js 16 + Tailwind. **Providers:** Didit Sandbox (KYB), Lithic
Sandbox (cards). **Deploy:** Render (API) + Netlify (web).

> Everything financial in this repository runs against **sandbox** providers.
> The only real values are the ledger invariants.

## Modules

| Module | Status | Surface |
| --- | --- | --- |
| 1 — Onboarding / KYB | done | `/register`, `/onboarding/*`, Didit sessions and webhooks |
| 2 — Role dashboard | done | one shell, role-aware nav, profile menu, mobile drawer |
| 3 — Wallet + ledger | done | deposits, holds, journal entries, integrity check, reversal |
| 4 — Lithic Sandbox cards | done | issue, freeze, cancel, authorize, clear, void, refund |
| 5 — Team, payments, approvals | specified, not built | invitations, maker-checker, payment requests |

`planning/` is gitignored on purpose: specs and audit notes stay local, the
submission contains code, this README and `decision-log.md`.

## Repository layout

```text
backend/   Express API
  prisma/        schema, migrations, demo seed
  src/
    controllers/ HTTP surface (one controller per resource)
    services/    business rules; money logic lives in ledger.service.ts
    integrations/ didit/ and lithic/ adapters
    middlewares/ auth, rate limits, request context
frontend/  Next.js app router
  app/           public, onboarding and dashboard routes
  components/    shell, dashboard widgets, UI primitives
  lib/           API client, auth/session, typed helpers
```

## Local setup

### 1. Database

```bash
# PostgreSQL 16+, then:
createdb neobank
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # fill in DATABASE_URL + JWT_SECRET
npm install
npm run db:migrate:deploy
npm run db:seed
npm run dev                   # http://localhost:5000
```

Health check: `GET http://localhost:5000/api/v1/health` → `{ "status": "ok" }`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
npm install
npm run dev                   # http://localhost:3000
```

### Demo accounts

All seeded accounts use password **`NeoBank@123`**:

| Email | Role | Sees |
| --- | --- | --- |
| `owner@neobank.dev` | OWNER | balance, cards, team, approvals, integrity |
| `admin@neobank.dev` | ADMIN | same customer surface, cannot change roles/threshold |
| `employee@neobank.dev` | EMPLOYEE | own card and own activity only |
| `ops@neobank.dev` | OPERATIONS | ledger integrity and manual reversal only |
| `pending@neobank.dev` | OWNER | a second, unverified tenant for isolation tests |

`NeoBank Demo Co` is seeded `ACTIVE`; `NeoBank Pending Co` is seeded
`PENDING_VERIFICATION` so the onboarding journey can be walked from the start.

## Environment

Backend variables (see `backend/.env.example` for the annotated list):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | ≥ 32 chars; rotating it invalidates every session |
| `CORS_ORIGIN` | yes in prod | comma-separated browser origins |
| `FRONTEND_URL` | yes in prod | onboarding redirects |
| `PUBLIC_API_URL` | yes in prod | public API base for provider callbacks |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | yes in prod | Didit KYB |
| `LITHIC_API_KEY` | for cards | Lithic Sandbox key |
| `LITHIC_WEBHOOK_SECRET` | for webhooks | event-subscription signing secret |
| `LEDGER_SANDBOX_TOOLS_ACK` | yes in prod | must be `labelled` while sandbox funding tools are on |

Frontend variables:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | API base, e.g. `https://api.example.com/api/v1` |

`NEXT_PUBLIC_*` is public by definition. Never put a provider key behind it.

## Deploy

### API — Render

`render.yaml` is a blueprint for the `backend` service. It expects:

1. A Neon PostgreSQL database; paste its pooled connection string as
   `DATABASE_URL`.
2. The Didit and Lithic sandbox credentials.
3. `CORS_ORIGIN=https://<your-site>.netlify.app` and
   `FRONTEND_URL=https://<your-site>.netlify.app`.
4. `PUBLIC_API_URL=https://<your-service>.onrender.com`.

Migrations run on start (`npm run db:migrate:deploy`), so a fresh database is
ready on first boot.

### Web — Netlify

`netlify.toml` builds `frontend/` with `@netlify/plugin-nextjs`. Set
`NEXT_PUBLIC_API_URL` in **Site configuration → Environment variables** to the
public API base and trigger a deploy. The value is inlined at build time, so
changing it requires a rebuild, not just a restart.

### Provider callbacks

Point both providers at the public API:

```text
Didit   https://<api-host>/api/v1/webhooks/didit
Lithic  https://<api-host>/api/v1/webhooks/lithic
```

Both routes verify a signature over the raw body before parsing. Invalid
signatures return `401`; replayed event ids are stored once.

## What is intentionally simulated

- **KYB** uses Didit's sandbox workflow (or a clearly-labelled local simulator
  when no credentials are present).
- **Cards** are Lithic Sandbox virtual cards. No PAN or CVV is stored; the
  browser never sees card data.
- **Funding** is a sandbox deposit tool guarded by daily limits, an
  acknowledgement flag and `NODE_ENV=production` checks. It is not a bank rail.
- **Payments** (Module 5) are a simulator and will be labelled as such.

No live keys, real card numbers or real personal data belong in this repo.

## Ledger rules

1. Amounts are integer minor units (`BigInt`), never floats.
2. `LedgerEntry` is append-only: database triggers reject `UPDATE`, `DELETE` and
   `TRUNCATE`.
3. A transaction's money fields are immutable; only `status` may change.
4. Every journal must balance: debits equal credits.
5. A reversal is a new `REVERSAL` transaction linked to the original; the
   original becomes `REVERSED`. Nothing is rewritten.
6. Manual reversal is `OPERATIONS`-only, so a customer cannot bypass approval.
7. `GET /api/v1/operations/ledger/integrity` re-checks the invariants.

## Security model

- `businessId`, `role` and `userId` always come from the verified JWT.
- Foreign tenant ids return `404`, not `403`, so ids cannot be probed.
- Employees have no route to the business balance, the card list or another
  employee's activity.
- Passwords are bcrypt hashes; `tokenVersion` invalidates existing JWTs on
  logout-all or disable.
- Webhook payloads are sanitised before storage: no PAN, CVV, email, phone,
  government id or cardholder name.
- Secrets live in `.env` (ignored) and platform environment variables, never in
  source.

## Checks

```bash
cd backend && npm run typecheck && npm run build
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

## Decisions

`decision-log.md` records the choices that shaped the build, two to four lines
per entry.
