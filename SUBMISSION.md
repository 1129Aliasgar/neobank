# Corgi Track 3 — Submission Notes

## Engineering position

This repository is a focused Track 3 neobank slice, not a claim to have built
every feature of a regulated bank. The build boundary is seven modules because
the trial is a continuous 48-hour exercise: the first five modules establish a
credible money system, while the final two close the operational and agent
requirements. The order follows dependency and grading risk, not screen count.

The important design choice is to make the backend financially authoritative:
the browser requests actions, services re-check tenant membership and state, and
PostgreSQL transactions create holds, approvals and balanced journals. Provider
objects are references; provider balances are never treated as NeoBank truth.

## Why these seven modules

| Module | Why it exists | Current state |
| --- | --- | --- |
| 1 — onboarding/KYB | A business must be verified before money or cards are available. | Built with Didit Sandbox and signed/idempotent webhook handling. |
| 2 — role dashboard | Gives the same tenant-aware route distinct owner/admin/employee experiences. | Built. |
| 3 — account/ledger | Makes balance, available balance, holds, integer cents and reversals provable. | Built with append-only database protections. |
| 4 — Lithic cards | Demonstrates the assignment's most important asymmetry: authorization reserves funds, later settlement can differ. | Built locally against Lithic Sandbox APIs and webhook contracts. |
| 5 — team/payments/approvals | Demonstrates money-out maker-checker: the creator cannot approve, and approval posts exactly one ledger payment. | Built and exercised by the 111-check smoke matrix. |
| 6 — statements/reconciliation/operations | Required to prove bitemporal corrections, scheme breaks and provider health. | Next; the scope is defined in the next-module specification. |
| 7 — MCP agent surface | Required to expose three reads and one safe write into the human approval queue. | Next; scoped alongside Module 6. |

Building all seven at once would create shallow screens and an unverifiable
ledger. The deliberate cut protects the 30-point domain correctness area and
the 25-point running-system area first, then leaves a clean extension boundary
for the reconciliation and MCP work.

## Provider decisions and mark risk

### Didit and Lithic

The two provider integrations were selected because they cover the two mandatory
live integration slots available in this project:

1. Didit Sandbox for KYB verification sessions and signed status events.
2. Lithic Sandbox for cardholders, virtual cards, card lifecycle and signed card
   authorization/transaction events.

Stripe Issuing was unavailable in the project region. Lithic was substituted
behind a provider-neutral card boundary, so the card, authorization, hold and
ledger domain did not change.

### What is simulated

Outbound payment processing is explicitly a simulator. It is labelled in the
API and UI, and approval posts only the internal `PAYMENT` journal. No ACH,
wire, Plaid, stablecoin or bank-transfer claim is made.

This is consistent with the brief's provider table, which permits payment rails
and open-banking funding to be live or simulated. However, it does reduce the
integration/live-fire score compared with adding a real payment rail. The
mandatory risk is provider evidence: the deployed Didit and Lithic webhook
delivery logs must be captured before submission. Local signature tests prove
the consumer, but they are not a substitute for deployed third-party delivery.

### Rubric mapping

| Rubric area | Decision made | Evidence / remaining risk |
| --- | --- | --- |
| Domain command (30) | Prioritize immutable journals, holds, different captures, reversals and maker-checker before optional rails. | Strong locally; Modules 6 statements/reconciliation are still needed for the bitemporal gauntlet. |
| System runs (25) | Keep one tenant-scoped API, one USD account and role-specific pages. | Local end-to-end flows pass; deployment still needs a public URL and seeded demo setup. |
| Integration reality (20) | Use Didit and Lithic Sandbox rather than build provider-shaped fakes. Label payment rail as simulated. | Two integrations exist in code; collect deployed webhook evidence. A third live money rail is not present. |
| Live fire (15) | Make every external event idempotent, tolerate out-of-order card events, and serialize approvals. | Card/payment local attacks pass; statements/reconciliation/provider outage handling remain Module 6. |
| Judgment (10) | Keep a timestamped decision log, explicit cut list and provider labels. | [`decision-log.md`](decision-log.md) and this document explain the trade-offs. |

The choices may lose marks for the missing real payment rail, missing
reconciliation and missing MCP surface. They avoid the more serious failure of
presenting a simulator as a live integration or a mutable balance as ledger
truth.

## Manual test flow

### Path A — start from zero

1. Start PostgreSQL, run migrations and `npm run db:seed`.
2. Start the backend on port `5000` and frontend on port `3000`.
3. Open `/register` and create a business owner.
4. Complete the business profile.
5. Open the verification flow. With Didit credentials configured, complete the
   Sandbox verification and let the signed webhook update the business. Without
   provider credentials, the local simulator is clearly labelled and is not a
   production KYB claim.
6. After `nextStep = DONE`, open `/dashboard`. The account and card/payment
   routes remain gated until verification is complete.

### Path B — seeded reviewer flow

1. Run `npm run db:seed`; use the credentials printed by the seed command.
2. Sign in as an owner/admin and open **Account**, **Cards**, **Team**,
   **Payments** and **Approvals**.
3. Sign in as the employee in a separate session. Confirm the employee sees
   only their own card and requests, not the business balance, team or approval
   queue.
4. Create a payment request above the threshold. It must remain
   `PENDING_APPROVAL` and must not change the ledger.
5. Try to approve it as the creator. The API returns `403` even if a client
   manually calls the endpoint.
6. Approve it as a different owner/admin. Exactly one balanced `PAYMENT`
   journal is posted and the request becomes `COMPLETED`.
7. Replay the approval or double-click it. The second attempt returns `409` and
   no second journal is created.
8. Reject another request with a reason and cancel a pending request as its
   creator. Both are terminal and post no money.

### Path C — Lithic card loop

1. Configure a Lithic Sandbox API key and enable the Lithic provider.
2. As owner/admin, open **Cards**, choose an active employee, set a limit and
   issue a virtual card.
3. Configure the Lithic Event Subscription URL to
   `/api/v1/webhooks/lithic` on the deployed API and store the subscription
   secret in `LITHIC_WEBHOOK_SECRET`.
4. Simulate a card authorization. Available balance decreases while ledger
   balance stays unchanged.
5. Deliver a clearing/capture for a different amount. The hold releases and the
   actual settled amount posts to the ledger.
6. Replay the event, send settlement before authorization, then reverse the
   settlement. The consumer must park/replay safely, remain idempotent and use
   new reversal entries rather than editing money history.

### Path D — Postman/API-only checks

These operations are useful when a reviewer wants to inspect server-side gates:

```text
GET  /api/v1/health
GET  /api/v1/businesses/current
GET  /api/v1/accounts/current
GET  /api/v1/accounts/current/transactions
GET  /api/v1/team
POST /api/v1/team/invitations
GET  /api/v1/team/invitations/{token}
POST /api/v1/payments
GET  /api/v1/approvals
POST /api/v1/payments/{id}/approve
POST /api/v1/payments/{id}/reject
POST /api/v1/payments/{id}/cancel
GET  /api/v1/operations/ledger/integrity
GET  /api/v1/cards
GET  /api/v1/cards/eligible-employees
POST /api/v1/cards
POST /api/v1/cards/{id}/freeze
POST /api/v1/cards/{id}/cancel
```

Use the bearer token returned by login, never a client-supplied `businessId`.
Payment creation accepts integer cents, for example:

```json
{
  "beneficiaryName": "Acme Supplies",
  "beneficiaryReference": "INV-1042",
  "amountMinor": "500000",
  "memo": "Office chairs"
}
```

Send `Idempotency-Key` when retrying payment creation. Approval/rejection
requires a different human owner/admin; no Postman body can bypass that rule.
Card creation requires a configured Lithic Sandbox key and an active employee;
authorization and settlement events are sent through Lithic's dashboard/event
simulator rather than invented by a client request.

## Reproducible checks completed

```text
Prisma migrations       up to date
Backend typecheck/build  pass
Frontend lint/typecheck  pass
Frontend production build pass
Module 5 smoke matrix    111 passed, 0 failed
```

The repository's smoke script is retained as a regression checker. It is not a
provider simulator presented as live evidence; its output is local verification
of authorization, tenancy, idempotency and ledger behavior.
