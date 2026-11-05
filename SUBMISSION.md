# Corgi Track 3 — NeoBank

**Track:** 3 — Neobank  
**Builder:** Aliasgar Bootwala  
**Live app:** <https://neo-bank-corgi.netlify.app>  
**API health:** <https://neobank-b8i4.onrender.com/api/v1/health>  
**Repository:** <https://github.com/1129Aliasgar/neobank>

NeoBank is a business banking slice for US companies: KYB onboarding, a
role-aware team workspace, a USD wallet backed by an immutable double-entry
ledger, Lithic Sandbox virtual cards, and outbound payments with maker-checker
approval.

---

## What is built

| Module | What it does | State |
| --- | --- | --- |
| 1 — Onboarding / KYB | Registration, business profile, Didit Sandbox hosted KYB, signed/idempotent webhook, polling fallback, retry | Built |
| 2 — Role dashboard | OWNER / ADMIN / EMPLOYEE / OPERATIONS with server-side route guards | Built |
| 3 — Account + ledger | USD wallet, integer cents, holds, double-entry journals, append-only entries, reversals, integrity check | Built |
| 4 — Lithic cards | Account holders, virtual cards, limits, freeze/cancel, authorization → hold → capture, refund/reversal, sandbox simulator | Built |
| 5 — Team + payments | Invitations, roles, disable member, approval policy, payment requests, maker-checker, reject/cancel | Built |
| 6 — Statements / reconciliation / operations | Period statements, provider-file matching, breaks, bitemporal corrections, ops queues | **Not built** |
| 7 — MCP agent surface | Three reads + one safe write into the human approval queue | **Not built** |

Modules 6 and 7 are scoped but not built. Nothing in this submission presents
them as working features.

### Honest boundaries

- **Payments are simulated.** Approval posts the internal `PAYMENT` ledger
  transaction. No ACH, wire, Plaid or bank transfer is claimed.
- **Didit and Lithic are Sandbox integrations**, not production providers. KYB
  is not a real regulatory approval.
- **Lithic card creation is real against Lithic Sandbox.** Live Lithic webhook
  delivery is not configured; the demo's merchant simulator calls Lithic's
  Sandbox authorization endpoint and delivers an HMAC-signed local event through
  the same ingestion path a real event uses.
- The ledger, holds, idempotency, maker-checker, tenant isolation and audit trail
  are real application logic with database constraints.

---

## Demo credentials

All seeded accounts use the same password:

```text
Password: NeoBank@123
```

| Email | Role | Business | What to use it for |
| --- | --- | --- | --- |
| `owner@neobank.dev` | OWNER | NeoBank Demo Co (ACTIVE) | Full workspace, team, cards, approvals |
| `admin@neobank.dev` | ADMIN | NeoBank Demo Co (ACTIVE) | Operator workspace without owner-only controls |
| `employee@neobank.dev` | EMPLOYEE | NeoBank Demo Co (ACTIVE) | Employee dashboard, own card, own payments |
| `ops@neobank.dev` | OPERATIONS | NeoBank Demo Co (ACTIVE) | API-only ledger integrity / reversal role |
| `second@neobank.dev` | OWNER | NeoBank Second Co (ACTIVE) | Tenant isolation check |
| `pending@neobank.dev` | OWNER | NeoBank Pending Co (PENDING_VERIFICATION) | Onboarding / KYB walkthrough |

### Seeded state

- **NeoBank Demo Co** is verified and active.
- Ledger balance **$24,903.30**, active sandbox hold **$120.00**, available
  **$24,783.30**.
- One pending **$5,000.00** payment request and one rejected **$1,200.00**
  request (a terminal decision that posted no money).
- Approval threshold **$0.00**, so every positive payment needs a second person.
- **No card is seeded** — the demo issues one live through Lithic Sandbox.
- **NeoBank Pending Co** has an incomplete profile and no verification, so
  onboarding can be walked from the beginning.

---

## Evidence pack (live integrations)

**Evidence folder:** <https://github.com/1129Aliasgar/neobank/tree/main/assets>
(index: [`assets/README.md`](assets/README.md))

| File | What it shows |
| --- | --- |
| `assets/didit-webhook.png` | Didit Sandbox webhook destination |
| `assets/didit-webhook-overview.png` | Didit webhook delivery overview |
| `assets/didit-webhook-event1.png` | Didit webhook event detail |
| `assets/didit-webhook-event2.png` | Didit webhook event detail |
| `assets/lithic-card-issuing.png` | Card issued against Lithic Sandbox |
| `assets/frontend.png` | Deployed frontend |
| `assets/schema.svg` | Data model |

The Didit screenshots show webhook delivery for the KYB integration. For Lithic,
the evidence is card creation/issuing against Sandbox: `/v1/event_subscriptions`
returns an empty list because live Lithic webhook delivery is not configured, and
this submission does not claim it. Card creation is real; the provider card id is
shown on the card detail page so any card can be matched in the Lithic dashboard
(Issuing → Cards, Sandbox mode).

If the repository is private, Corgi reviewers need the GitHub invitation
(`@AlexanderReinicke`, `@mojafa`) to open that folder. Alternatively the same
screenshots are shared as a read-only Google Drive folder:

```text
[FILL IN: Google Drive view-only shared folder link]
```

---

## Repository links

| Item | Link |
| --- | --- |
| Timestamped decision log | [`decision-log.md`](decision-log.md) |
| Seed script | [`backend/prisma/seed.ts`](backend/prisma/seed.ts) |
| Environment template | [`backend/.env.example`](backend/.env.example) |
| Database reset | [`backend/scripts/clean-db.ts`](backend/scripts/clean-db.ts) |
| Smoke tests | [`backend/scripts/smoke.mjs`](backend/scripts/smoke.mjs) |

### Database reset

`backend/scripts/clean-db.ts` drops and recreates the `public` schema, then
migrations and the seed are re-applied. It refuses to run without
`CLEAN_DB_CONFIRM=YES` and never prints the connection string.

```powershell
cd backend
$env:CLEAN_DB_CONFIRM="YES"
npm run db:reset:demo
```

The database was reset and re-seeded after production testing; the submission
starts from the documented clean state above. The reset is destructive — use it
only on the demo database.
