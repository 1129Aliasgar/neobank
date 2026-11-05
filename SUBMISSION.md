# Corgi Track 3 — NeoBank Submission

**Track:** 3 — Neobank  
**Builder:** Aliasgar Bootwala  
**Repository:** <https://github.com/1129Aliasgar/neobank>  
**Frontend:** <https://neo-bank-corgi.netlify.app>  
**Backend:** <https://neobank-b8i4.onrender.com>  
**Health check:** <https://neobank-b8i4.onrender.com/api/v1/health>

> NeoBank is a business banking slice for US companies: KYB onboarding, a
> role-aware team workspace, a USD wallet backed by an immutable double-entry
> ledger, Lithic Sandbox virtual cards, and outbound payments with
> maker-checker approval. Modules 1–5 are built. Modules 6–7 are scoped but not
> built, and this document says so.

---

## 1. What is in the submission

| Item | Link / location |
| --- | --- |
| Running app | <https://neo-bank-corgi.netlify.app> |
| API health | <https://neobank-b8i4.onrender.com/api/v1/health> |
| Source code | <https://github.com/1129Aliasgar/neobank> |
| Full module/Q&A/scaling explanation | [`explanation.md`](explanation.md) |
| Timestamped decisions | [`decision-log.md`](decision-log.md) |
| Demo video | `[FILL IN VIDEO LINK]` |
| Evidence pack (optional) | `[FILL IN IF USED]` |

### What to open first

1. Open the frontend and sign in as `owner@neobank.dev`.
2. Open **Account**, **Transactions**, **Cards**, **Team**, **Payments** and
   **Approvals**.
3. Sign in as `employee@neobank.dev` in a second browser profile and compare the
   navigation: the employee sees only **Overview**, **My card** and **Payments**.

---

## 2. Demo credentials

All seeded accounts use the same password:

```text
Password: NeoBank@123
```

| Email | Role | Business | What to use it for |
| --- | --- | --- | --- |
| `owner@neobank.dev` | OWNER | NeoBank Demo Co (ACTIVE) | Full workspace, team, cards, approvals |
| `admin@neobank.dev` | ADMIN | NeoBank Demo Co (ACTIVE) | Operator workspace without owner-only controls |
| `employee@neobank.dev` | EMPLOYEE | NeoBank Demo Co (ACTIVE) | Employee dashboard, own card, own payments |
| `ops@neobank.dev` | OPERATIONS | NeoBank Demo Co (ACTIVE) | API-only ledger integrity / reversal role (no frontend operations page) |
| `second@neobank.dev` | OWNER | NeoBank Second Co (ACTIVE) | Tenant isolation check |
| `pending@neobank.dev` | OWNER | NeoBank Pending Co (PENDING_VERIFICATION) | Onboarding/KYB walkthrough |

### Seeded state

- **NeoBank Demo Co** is verified and active.
- Opening ledger balance: **$25,000.00**.
- Two seeded card captures: **$84.20** and **$12.50**.
- Ledger balance after seed: **$24,903.30**.
- One active sandbox hold: **$120.00**.
- Available balance: **$24,783.30**.
- One pending **$5,000.00** payment request from the employee to "Acme Supplies".
- One rejected **$1,200.00** travel request (proves a terminal decision that
  posted no money).
- Approval policy: threshold **$0.00**, so every positive payment needs a second
  person.
- **No card is seeded.** The demo issues one live. This is deliberate: it shows
  the full Lithic create → authorize → settle flow.
- **NeoBank Pending Co** has an incomplete profile and no verification, so the
  onboarding flow can be walked from the beginning.

---

## 3. Status and honest boundary

| Module | What it does | State |
| --- | --- | --- |
| 1 — Onboarding/KYB | Registration, business profile, Didit Sandbox hosted KYB, signed/idempotent webhook, polling fallback, retry | Built |
| 2 — Role dashboard | OWNER / ADMIN / EMPLOYEE / OPERATIONS with server-side route guards | Built |
| 3 — Account + ledger | USD wallet, integer cents, holds, double-entry journals, append-only entries, reversals, integrity check | Built |
| 4 — Lithic cards | Account holders, virtual cards, limits, freeze/cancel, authorization → hold → capture, refund/reversal, sandbox simulator | Built |
| 5 — Team + payments | Invitations, roles, disable member, approval policy, payment requests, maker-checker, reject/cancel | Built |
| 6 — Statements/reconciliation/operations | Period statements, provider-file matching, breaks, bitemporal corrections, ops queues | **Not built** |
| 7 — MCP agent surface | Three reads + one safe write into the human approval queue | **Not built** |

Modules 6 and 7 are described in [`explanation.md`](explanation.md). They are
not presented as working features.

### What is simulated

- **Outbound payments:** a clearly labelled simulator. Approval posts the
  internal `PAYMENT` ledger transaction. No ACH, wire, Plaid or bank transfer is
  claimed.
- **Card merchant events in the demo:** the owner/admin uses a sandbox simulator
  that calls Lithic's Sandbox authorization endpoint and then delivers an
  HMAC-signed local webhook through the same ingestion path a real event uses.
  This proves the consumer and the ledger, not live provider delivery.
- **KYB:** Didit Sandbox, not a real regulatory approval. The provider integration
  and signed-webhook path are real.

### What is real

- The ledger, holds, idempotency, maker-checker, tenant isolation and audit trail
  are real application logic with database constraints.
- Lithic card creation is real against Lithic Sandbox. Direct API calls with the
  configured key returned the cards and account holders created by this app.
- Didit session creation is real against Didit Sandbox.

---

## 4. Production test results

These checks were run against the deployed API on **2026-11-04/05**:

```text
API: https://neobank-b8i4.onrender.com/api/v1
Health: 200 {"status":"ok"}
Frontend: https://neo-bank-corgi.netlify.app (HTTP 200)

Read-only matrix       53 passed, 0 failed
Team flow matrix      111 passed, 0 failed
Card flow matrix       65 passed, 0 failed
```

What the matrices cover:

- Health, login for every role, wrong-password refusal.
- Employee cannot read the business balance, issue a card, list the team or read
  the approval queue.
- Operations can read ledger integrity but cannot reverse money.
- Unverified business is refused with `409`.
- Foreign tenant ids return `404`, not `403`.
- Invitation create/revoke/accept, role changes, owner-only rules.
- Payment create, self-approval refusal, threshold policy, reject, cancel,
  double-approval `409`, exactly one ledger post.
- Card list isolation, card issue, authorization/clear idempotency, frozen card
  refusal, replay safety.
- Ledger integrity remains clean after the flows.

The tests mutate the demo database (they create users, payments, cards and ledger
rows). The database was reset and re-seeded after testing, so the submission
starts from the documented clean state. Re-running the mutating flows will
change that state; that is expected.

### What was verified about Lithic

Direct Sandbox API calls with the configured key returned:

```text
3 cards
4 account holders (all ACCEPTED)
GET /v1/event_subscriptions -> { "data": [] }
```

At the time of inspection:

| Card token | State | Last four |
| --- | --- | --- |
| `ac40383e-f450-49e0-be7b-a10f9fbfaddd` | CLOSED | 0014 |
| `8ad84034-b2e6-4139-a94c-ff280cafe19b` | PAUSED | 6571 |
| `bfc388f4-9090-4989-bde2-23d872b4b2b9` | OPEN | 7704 |

The app's card list comes from NeoBank's database. The provider card id is now
shown on the card detail page, so any card can be matched to Lithic.

---

## 5. Why cards may not appear in the Lithic dashboard

**The integration is not broken.** The cards exist in the Lithic Sandbox
account. An empty-looking dashboard is a view/scope problem, not a failed create.

Check these in order:

1. **Sandbox vs Production toggle.** The API key is a Sandbox key
   (`https://sandbox.lithic.com/v1`). Switch the Lithic dashboard to
   **Sandbox / Test mode**. Sandbox cards never appear in the production view.
2. **Correct section.** Cards are under **Issuing → Cards**. Account holders are
   under **Issuing → Account holders** / Cardholders. They are not under
   Payments or Transactions.
3. **State filter.** The dashboard often defaults to `OPEN` only. One inspected
   card was `CLOSED` and one was `PAUSED`. Clear the filter or include those
   states.
4. **Workspace / program.** The dashboard user must be in the same workspace and
   program as the API key. A key created in another workspace will return data
   through the API but show nothing in the current dashboard view.
5. **Search by token.** Copy the "Lithic card ..." id from the NeoBank card
   detail page and search for it in the dashboard. If the API returns it but the
   dashboard does not, the dashboard is in a different environment or workspace.
6. **Provider proof.** Call
   `GET https://sandbox.lithic.com/v1/cards/{providerCardId}` with the same API
   key. A `200` proves the card exists at Lithic.

Also note: webhook delivery is not configured. `LITHIC_EVENT_SUBSCRIPTION_TOKEN`
is empty and `LITHIC_WEBHOOK_SECRET` is a placeholder, and
`/v1/event_subscriptions` returns an empty list. The app's sandbox simulator
therefore delivers a locally signed event through the real ingestion path. Card
creation is real; live provider webhook delivery is not claimed.

For the demo, open the card detail page and point at the **"Lithic card ..."**
line. That is the token to paste into the dashboard search or the API call.

---

## 6. Clean database script and reset

### What it does

`backend/scripts/clean-db.ts` removes every row by dropping and recreating the
`public` schema. This is necessary because the ledger has append-only triggers
that block `TRUNCATE` on `LedgerEntry`. Dropping the schema also removes Prisma's
migration history, so migrations must be re-applied before the seed.

`backend/package.json` exposes:

```json
"db:clean": "tsx scripts/clean-db.ts",
"db:reset:demo": "npm run db:clean && npm run db:migrate:deploy && npm run db:seed"
```

The script refuses to run without `CLEAN_DB_CONFIRM=YES`, prints only the
database host and name, and never prints the connection string. It is **not**
part of any deploy or start command.

### Run it (PowerShell, from `backend/`)

```powershell
$env:CLEAN_DB_CONFIRM="YES"
npm run db:reset:demo
```

### Run it (bash, from `backend/`)

```bash
CLEAN_DB_CONFIRM=YES npm run db:reset:demo
```

### Expected output

```text
Cleaning PostgreSQL database neondb at <host>...
Public schema dropped and recreated (all rows removed).
...
8 migrations found ...
Database schema is up to date!
seeded NeoBank Demo Co · OWNER      owner@neobank.dev
seeded NeoBank Demo Co · ADMIN      admin@neobank.dev
seeded NeoBank Demo Co · EMPLOYEE   employee@neobank.dev
seeded NeoBank Demo Co · OPERATIONS ops@neobank.dev
seeded NeoBank Second Co · OWNER    second@neobank.dev
seeded NeoBank Pending Co · OWNER   pending@neobank.dev
Demo password for all accounts: NeoBank@123
```

### Safety

- This is **destructive**. Use it only on the demo Neon database.
- Do not run it against a database with data you care about.
- The reset uses the `DATABASE_URL` in `backend/.env`. Confirm the host is the
  demo database before running it.
- After the reset there is **no card**. Issue one in the demo.

### Quick verification after reset

- `GET /api/v1/health` returns `200`.
- `owner@neobank.dev` can sign in.
- Account shows `$24,903.30` ledger, `$120.00` hold, `$24,783.30` available.
- Team shows 4 members: owner, admin, employee, operations.
- Cards is empty until the owner issues one.
- Payments shows one pending $5,000 request and one rejected $1,200 request.

---

## 7. Five-minute video walkthrough

**Goal:** show the full money story: onboarding → roles → ledger → card spend →
payment approval.

**Before recording**

- Reset the database and wait for the seed to finish.
- Open a desktop browser at 100–110% zoom with bookmarks hidden.
- Prepare two browser profiles: **owner** and **employee**. A third profile for
  `pending@neobank.dev` is useful for the onboarding segment.
- Have a phone ready for the Didit QR (Didit's business KYB flow is mobile-only
  in this configuration).
- Do not issue a card before recording; issue it live.
- Use **$50.00** authorization and **$73.40** settlement for the card segment.
- Use **$5,000.00** and beneficiary **Acme Supplies** for the payment segment.

### 0:00–0:25 — Opening

**Show:** the landing page.

**Say:**

> This is NeoBank, a business banking slice for US companies. The backend is
> financially authoritative: every balance comes from an immutable double-entry
> ledger. Today I'll show onboarding, team roles, the ledger, card issuing with a
> real Lithic Sandbox card, and a payment that needs a second approver.

### 0:25–1:20 — Onboarding with the pending user

**Show:** sign in as `pending@neobank.dev` / `NeoBank@123`.

1. The app redirects to `/onboarding/business`.
2. Fill the profile. Use these values:

```text
Legal name:        NeoBank Pending Co
Trading name:      Pending Co
Business type:     LLC
Registration no.:  SEED-PENDING-0003
Industry:          Software
Description:       Pending demo business
Email:             pending@neobank.dev
Phone:             +14155550125
Website:           https://pending.neobank.dev
Address line 1:    700 Market Street
Address line 2:    Suite 300
City:              San Francisco
State:             CA
ZIP:               94103
```

3. Continue to verification and click **Start verification**.
4. A Didit QR code appears. Say: *"Didit's business KYB workflow is mobile-only
   here. I'll scan the QR, complete the sandbox scenario, and the status page
   updates without me copying a result back."*
5. Scan the QR, complete the Didit sandbox flow (approve scenario).
6. Return to the app; the status page flips to approved and the dashboard opens.

**Say:**

> The provider writes the decision. NeoBank applies it once through a signed
> webhook or the polling fallback. Before approval, the account and card routes
> return 409 even if you call them directly. This is Didit Sandbox, not a real
> regulatory approval.

**If the QR flow cannot be completed during recording:** show the QR, explain
the mobile constraint, then cut to the already-verified owner. Do not pretend the
pending business was approved if it was not.

### 1:20–2:00 — Team and role dashboards

**Show:** sign in as `owner@neobank.dev` → **Team**.

1. Point at the four members and their roles: OWNER, ADMIN, EMPLOYEE,
   OPERATIONS.
2. Invite a person as **Employee** (use `newhire@neobank.dev` or any unused
   address).
3. Copy the one-time link and say: *"NeoBank does not send email. The raw token
   is shown once; only its SHA-256 hash is stored. It expires in seven days and
   can be revoked."*
4. Point at the approval policy: threshold **$0.00**. Say: *"Every positive
   payment needs a second person."*

**Switch to the employee profile** at `employee@neobank.dev`.

5. Show that the navigation is only **Overview**, **My card** and **Payments**.
6. Say: *"The employee cannot see the balance, team or approval queue. The UI
   hides the links, but the API also returns 403 if they call them."*

**Optional:** switch to `admin@neobank.dev` and show that the Team page loads but
role-change and disable controls are owner-only.

### 2:00–2:45 — Account and ledger

**Show:** owner → **Account**.

1. Point at ledger balance `$24,903.30`, hold `$120.00`, available
   `$24,783.30`.
2. Say: *"The balance is computed from ledger entries, not stored as an editable
   column. The hold is a card authorization reservation; it reduces available but
   not ledger balance."*
3. Open **Transactions**. Show the $25,000 deposit and the two card captures.
4. Open one transaction. Show the two lines: debit `2010 WALLET`, credit `1010
   CUSTOMER_FUNDS`.
5. Say: *"Every journal is balanced. Ledger entries are append-only at the
   database level; corrections are reversals, not edits."*

### 2:45–3:45 — Issue a card and show authorization vs settlement

**Show:** owner → **Cards**.

1. Choose `employee@neobank.dev`, set a **$500 monthly** limit, issue the card.
2. Open the card detail page. Point at the last four digits and the **"Lithic
   card ..."** id.
3. Say: *"This is a real virtual card in Lithic Sandbox. The id on screen is the
   provider card id, so it can be matched in the Lithic dashboard under Issuing →
   Cards in Sandbox mode."*
4. In the sandbox simulator, set merchant **NEOBANK SANDBOX CAFE** and amount
   **$50.00**. Run the authorization.
5. Show that available balance drops by $50 while ledger balance is unchanged.
6. Set the **Settle amount** to **$73.40** and clear the authorization.
7. Show that the ledger now drops by $73.40, the hold is released, and the extra
   $23.40 came from the wallet.
8. Say: *"This is the tip/fuel case: authorization reserves $50, the merchant
   settles $73.40. The ledger posts the real amount, not the authorization."*

**Optional:** freeze the card and show that a new authorization is declined.

### 3:45–4:40 — Employee payment and maker-checker

**Show:** employee profile → **Payments**.

1. Create a payment request:

```text
Beneficiary: Acme Supplies
Reference:   INV-2001
Amount:      $5,000.00
Memo:        Office furniture
```

2. Show that it is **Pending approval** and that no money moved.
3. Switch to the owner profile → **Approvals**.
4. Point out that the creator cannot approve their own request.
5. Approve the employee's request.
6. Show the request becomes **Completed** and a new `PAYMENT` transaction appears
   in the ledger.
7. Say: *"Approval and the ledger post are one database transaction. The request
   row is locked, so two simultaneous approvers cannot both win. The second gets
   409 and exactly one payment is posted."*

**Optional 15-second proof:** create a request as the owner, open it in
Approvals, and show that the approve action is not offered. Say: *"Even the owner
cannot approve their own request."*

### 4:40–5:00 — Close

**Say:**

> That is the built slice: real Didit Sandbox KYB, real Lithic Sandbox cards, a
> double-entry ledger, and maker-checker payments. Modules 6 and 7 —
> reconciliation/statements and the MCP agent surface — are scoped but not built.
> The payment rail is a labelled simulator, and live Lithic webhook delivery is
> not configured. The full module explanation and Q&A are in `explanation.md`.

---

## 8. Live demo runbook (quick sheet)

### A. Onboarding

1. Sign in as `pending@neobank.dev`.
2. Complete the profile with the values in section 7.
3. Start verification; scan the Didit QR with a phone; choose the approve
   scenario.
4. Confirm the business becomes `ACTIVE` and the dashboard opens.

### B. Team

1. Sign in as `owner@neobank.dev`.
2. **Team** → invite `newhire@neobank.dev` as Employee.
3. Copy the link; explain the hash, seven-day expiry, single use and revoke.
4. **Team** → show the four seeded roles and the $0 approval threshold.
5. Sign in as `employee@neobank.dev` in a second profile; show the smaller
   navigation.

### C. Ledger

1. Owner → **Account**: ledger $24,903.30, hold $120.00, available $24,783.30.
2. **Transactions** → open one → show the balanced debit/credit lines.

### D. Card

1. Owner → **Cards** → issue a card to the employee, $500/month.
2. Open the card detail; copy/show the Lithic card id.
3. Simulator: merchant `NEOBANK SANDBOX CAFE`, authorization `$50.00`.
4. Show available −$50, ledger unchanged.
5. Settle `$73.40`; show ledger −$73.40 and the hold released.

### E. Payment

1. Employee → **Payments** → create $5,000 to Acme Supplies.
2. Owner → **Approvals** → approve.
3. Show status Completed and the new ledger transaction.
4. Optional: double-approve to show `409`; owner creates own request to show
   self-approval is blocked.

### F. If something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Login says no active membership | Seed was not run, or a member was disabled during testing | Run `npm run db:seed` again (or reset) |
| No employees in the card dropdown | Employee membership is not ACTIVE | Re-run seed |
| Lithic create fails | Key/base URL/environment mismatch, or provider outage | Check `LITHIC_API_KEY`, `LITHIC_BASE_URL=https://sandbox.lithic.com/v1`, `LITHIC_ENVIRONMENT=sandbox` |
| Card created but not in dashboard | Sandbox toggle, wrong workspace, or state filter | Use the checklist in section 5 |
| Payment is auto-approved | Threshold is above the amount | Set the threshold to 0 in **Team** or re-seed |
| Approve button missing | You are the creator | Sign in as a different owner/admin |
| Didit QR does not open on desktop | Didit business KYB is mobile-only | Scan the QR with a phone |
| Deployed UI is stale | Render/Netlify has not redeployed | Push the commit or trigger a manual deploy |

---

## 9. Submission email

Replace the video link and any personal details before sending.

```text
Subject: Corgi Track 3 — NeoBank submission (Aliasgar Bootwala)

Hi Corgi team,

Here is my Track 3 (Neobank) submission.

Live app:   https://neo-bank-corgi.netlify.app
API:        https://neobank-b8i4.onrender.com/api/v1/health
Repository: https://github.com/1129Aliasgar/neobank
Video:      [FILL IN]
Module/Q&A: https://github.com/1129Aliasgar/neobank/blob/main/explanation.md

What is built (Modules 1–5):
- KYB onboarding with Didit Sandbox: hosted session, signed webhook, polling
  fallback, retry, and server-side gating of money/card routes.
- Role-aware workspace: OWNER, ADMIN, EMPLOYEE and OPERATIONS, enforced in the
  API, not just hidden in the UI.
- USD wallet and immutable double-entry ledger: integer cents, holds, balanced
  journals, append-only entries, reversals and an operations integrity check.
- Lithic Sandbox virtual cards: account holders, card issuing, limits,
  freeze/cancel, authorization -> hold -> capture, refund/reversal, and a
  sandbox merchant simulator.
- Team and maker-checker payments: hashed one-time invitations, owner-only role
  changes, approval policy, payment requests, self-approval refusal, reject,
  cancel, and exactly one ledger post per approved payment.

What is not built: Modules 6 (statements/reconciliation/operations) and 7 (MCP
agent surface). They are scoped in the local planning notes and stated honestly
in the submission.

Honest boundaries:
- Outbound payments are a clearly labelled simulator, not ACH/wire.
- Lithic card creation is real against Lithic Sandbox. Live provider webhook
  delivery is not configured; the demo simulator delivers a locally signed event
  through the same ingestion path.
- KYB is Didit Sandbox, not a real regulatory approval.

Demo login: owner@neobank.dev / NeoBank@123
Other roles: admin@, employee@, ops@, second@, pending@ (same password).

The database was reset and re-seeded after production testing. The reset script
is backend/scripts/clean-db.ts and is documented in SUBMISSION.md.

Thanks,
Aliasgar
```

---

## 10. Reproducing the checks

### Local

```bash
cd backend
npm ci
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Then:

```bash
cd backend
npm run typecheck
npm run build
npm run smoke
SMOKE_TEAM_FLOW=1 npm run smoke
SMOKE_CARD_FLOW=1 npm run smoke
```

The smoke script defaults to `http://localhost:5000/api/v1`. To test the
deployed API:

```powershell
$env:API_URL="https://neobank-b8i4.onrender.com/api/v1"
npm run smoke
```

### Production reset

```powershell
cd backend
$env:CLEAN_DB_CONFIRM="YES"
npm run db:reset:demo
```

Do not run the mutating smoke flows after the final reset if you want the
documented pristine seed state.

### Build status

```text
Backend typecheck        pass
Backend build            pass
Frontend tsc --noEmit    pass
Frontend lint            pass
Frontend production build pass (22 routes)
Prisma migrations        up to date (8 migrations)
```

---

## 11. Key API routes for reviewers

```text
GET    /api/v1/health
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
POST   /api/v1/auth/logout

GET    /api/v1/businesses/current
PATCH  /api/v1/businesses/current
GET    /api/v1/businesses/current/verification
GET    /api/v1/businesses/current/verification/history
POST   /api/v1/businesses/current/verification
POST   /api/v1/businesses/current/verification/simulate
GET    /api/v1/businesses/current/approval-policy
PATCH  /api/v1/businesses/current/approval-policy

GET    /api/v1/accounts/current
POST   /api/v1/accounts/current/deposits
GET    /api/v1/accounts/current/transactions
GET    /api/v1/accounts/current/transactions/{id}
POST   /api/v1/accounts/current/holds
POST   /api/v1/accounts/current/holds/{id}/capture
POST   /api/v1/accounts/current/holds/{id}/release
GET    /api/v1/operations/ledger/integrity
POST   /api/v1/operations/ledger/transactions/{id}/reverse

GET    /api/v1/cards
GET    /api/v1/cards/mine
GET    /api/v1/cards/eligible-employees
POST   /api/v1/cards
GET    /api/v1/cards/{id}
POST   /api/v1/cards/cardholders
POST   /api/v1/cards/{id}/freeze
POST   /api/v1/cards/{id}/unfreeze
POST   /api/v1/cards/{id}/cancel
GET    /api/v1/cards/{id}/authorizations
POST   /api/v1/cards/{id}/simulate/authorize
POST   /api/v1/cards/{id}/simulate/clear
POST   /api/v1/cards/{id}/simulate/void

GET    /api/v1/team
POST   /api/v1/team/invitations
GET    /api/v1/team/invitations/{token}
POST   /api/v1/team/invitations/{token}/accept
POST   /api/v1/team/invitations/{token}/register
POST   /api/v1/team/invitations/{id}/resend
DELETE /api/v1/team/invitations/{id}
PATCH  /api/v1/team/members/{id}
DELETE /api/v1/team/members/{id}

GET    /api/v1/payments
POST   /api/v1/payments
GET    /api/v1/payments/{id}
POST   /api/v1/payments/{id}/approve
POST   /api/v1/payments/{id}/reject
POST   /api/v1/payments/{id}/cancel
GET    /api/v1/approvals

POST   /api/v1/webhooks/didit
POST   /api/v1/webhooks/lithic
```

`/auth/me` is the only session-read route. `/auth/profile` was removed because it
was an exact alias and nothing used it.

Payments accept integer minor units:

```json
{
  "beneficiaryName": "Acme Supplies",
  "beneficiaryReference": "INV-2001",
  "amountMinor": "500000",
  "memo": "Office furniture"
}
```

Send an `Idempotency-Key` when retrying payment creation. Approval requires a
different human owner/admin; no request body can bypass that.

---

## 12. Repository layout

```text
backend/
  prisma/               schema, migrations, seed
  scripts/              smoke.mjs, clean-db.ts
  src/
    controllers/        HTTP routes and role middleware
    services/           business rules (auth, verification, ledger, card, team, payment)
    repositories/       Prisma data access
    integrations/       Didit client, Lithic client, simulator
    middlewares/        auth, rate limit, request id
    validators/         Joi request validation

frontend/
  app/                  Next.js App Router routes
  components/           dashboard, onboarding, auth, UI
  lib/                  API clients, money helpers, role navigation
```

For the complete module explanations, likely Corgi questions, scaling answers
and "what if" scenarios, read [`explanation.md`](explanation.md).
