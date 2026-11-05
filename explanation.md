# NeoBank — Modules, Decisions, Q&A and Scaling

This file explains what NeoBank does, how each built module works, why the
important decisions were made, and the questions a reviewer is likely to ask in
a live demo. It is written in plain English and avoids claiming anything the
code does not do.

> **Scope in one sentence:** NeoBank is a business banking demo for US-based
> companies: a business completes KYB, its owner invites a team, the business
> holds a USD wallet backed by an immutable double-entry ledger, employees get
> virtual cards, and outbound payments need a second person to approve them.

---

## 1. The product in one minute

A company signs up, proves it exists, and gets a business account. The owner can
invite an admin or an employee. The employee gets a virtual card and can create a
payment request. The owner or admin approves that request, and only then does the
ledger move money.

The main promise is **financial correctness over screen count**:

- Every balance is computed from ledger entries, not stored as an editable number.
- Every money movement is balanced (debits equal credits in the same transaction).
- A card authorization reserves money; a later settlement can be a different amount.
- A person can never approve their own payment.
- Provider webhooks are idempotent, because real webhooks are retried.

### What is built

| Module | What it is | Status |
| --- | --- | --- |
| 1 | Onboarding and KYB (business verification) | Built, Didit Sandbox |
| 2 | Role-aware dashboard | Built |
| 3 | USD account, wallet and double-entry ledger | Built |
| 4 | Virtual cards and card spend (Lithic Sandbox) | Built |
| 5 | Team, invitations, payment requests, maker-checker | Built |
| 6 | Statements, reconciliation and operations | Not built |
| 7 | MCP agent surface | Not built |

Modules 6 and 7 are described honestly at the end of this file. The submission
does not pretend they exist.

---

## 2. Architecture and stack

```
Browser (Next.js + TypeScript + Tailwind)
        |
        | HTTPS, Bearer token or httpOnly cookie
        v
Express API (TypeScript + Inversify dependency injection)
        |
        +--> PostgreSQL (Neon) through Prisma
        |       - users, businesses, memberships
        |       - accounts, ledger transactions, entries, holds
        |       - cards, authorizations, payment requests, approvals
        |       - webhook events, audit log
        |
        +--> Didit Sandbox   (KYB hosted session + signed webhook)
        |
        +--> Lithic Sandbox  (account holders, virtual cards, events)
        |
        +--> Payment rail simulator (clearly labelled, no real ACH/wire)
```

### Why a modular monolith

The whole product is one deployable API and one database. For a 48-hour build,
this is the right trade-off:

- One transaction boundary can cover "approve payment + post ledger + update
  request + write audit log". With separate services, that becomes a distributed
  transaction problem on day one.
- The modules still have clear seams: controllers, services, repositories and
  provider adapters. For example, all raw Lithic JSON lives in
  `backend/src/integrations/lithic/lithic.client.ts`.
- If the product grows, the ledger and webhook ingestion are the first pieces to
  split out, because they have the clearest scaling pressure.

### The backend is the source of truth

The browser is treated as untrusted:

- The client never sends a `businessId` that is trusted. The API reads the
  business from the authenticated membership on every request.
- The client never sends its own role. The role is read from the database.
- The client cannot approve its own payment, even if it calls the endpoint
  directly with curl.
- Provider balances are never used as NeoBank's balance. A provider object is a
  reference; the ledger is the book of record.

---

## 3. Money rules used everywhere

These rules apply to every module, so they are worth learning once.

1. **Money is an integer number of cents.** The API uses `amountMinor` as a
   string (for example `"5000"` means `$50.00`). JavaScript floating point is
   never used for money.
2. **A ledger transaction is balanced.** Every transaction has two or more
   entries, and total debits equal total credits. A database constraint checks
   this at commit time.
3. **Entries are append-only.** A PostgreSQL trigger rejects `UPDATE`, `DELETE`
   and `TRUNCATE` on `LedgerEntry`. A correction is a new reversal transaction,
   not an edit.
4. **Every money action has an idempotency key.** If the same request arrives
   twice, the second one returns the first result instead of moving money again.
5. **Holds reserve money; they do not move it.** A card authorization creates a
   hold. Available balance goes down, ledger balance does not. Settlement later
   posts the real ledger transaction and releases the hold.
6. **The database transaction is the unit of truth.** If any step fails, the
   whole transaction rolls back. There is no half-approved payment and no
   half-created ledger entry.

---

## 4. Module 1 — Onboarding and KYB

### 4.1 What the user can do

- Register a new business account with name, email and password.
- Complete a business profile: legal name, trading name, business type,
  registration number, industry, address, phone and website.
- Start a hosted KYB check with Didit.
- See the current verification state: not started, pending, in review, approved,
  rejected, or needs a retry.
- Retry after a decline with corrected details.
- Reach the dashboard only after the business becomes `ACTIVE`.

### 4.2 Step-by-step flow

1. **Register.** `POST /api/v1/auth/register` creates a `User`, a `Business` with
   status `PENDING_VERIFICATION`, and a `BusinessMember` with role `OWNER`.
   The caller cannot choose a role. A public registration is always an owner.
2. **Complete the profile.** The onboarding page collects the company details.
   The API validates them and stores them on the business.
3. **Start verification.** `POST /api/v1/businesses/current/verification`
   creates a Didit hosted session. The API stores the provider session id,
   environment (`SANDBOX`), attempt number and status.
4. **The provider decides.** Didit sends a signed webhook. The status page also
   polls the provider as a fallback. Both paths call the same transition
   function, so the result is applied once.
5. **Business becomes active.** An approval sets the business to `ACTIVE`. A
   decline sets it to `REJECTED` and allows a retry. A manual review keeps it
   pending. Only `ACTIVE` can open accounts, issue cards or move money.

### 4.3 How it is implemented

- `Business` stores the company profile and lifecycle status.
- `Verification` stores each attempt: provider, provider session id, status,
  attempt number, sandbox scenario and review result.
- `VerificationService` is the only place that applies a provider decision. The
  webhook, the polling fallback and the local simulator all go through it.
- The `nextStep` value is **derived** from the business status, profile
  completeness and the latest attempt. It is not a stored field that can drift.
- Webhook handling verifies the provider signature, stores the raw event with a
  unique event id, and processes it idempotently.
- The app never stores identity documents. They stay with Didit. NeoBank stores
  the decision and a small review summary.

### 4.4 Edge cases already handled

- Duplicate webhook: the event id is unique, so the second delivery is a no-op.
- Out-of-order or late webhook: a stale provider event cannot overwrite a newer
  terminal decision.
- Provider outage: session creation fails cleanly; no half-written verification
  row is left behind.
- Double-click on "Start verification": the service returns the existing active
  attempt instead of creating two sessions.
- Refresh during onboarding: the status is read from the database, so the page
  recovers.
- A pending business tries to call the account or card API directly: the API
  returns `409`, not just a hidden button.

### 4.5 Likely Corgi questions and answers

**Q: Why Didit and not a custom KYB form?**
A custom form only proves that someone typed a company name. Didit performs a
real registry/business check and gives us a decision we can defend. It also
demonstrates a real provider integration with signed webhooks.

**Q: What is the difference between KYB and KYC?**
KYC checks a person (identity, date of birth, document). KYB checks a business
(registration, ownership, address, industry). NeoBank does business-level KYB.
A real bank would also run KYC on the owners and beneficial owners. That is a
future extension, not a claim of this build.

**Q: Can a business use the account before verification?**
No. The API gates accounts, cards and money movement on `ACTIVE`. The UI also
hides those pages, but the server check is the real control.

**Q: What happens if the webhook never arrives?**
The status page polls the provider. The webhook is the fast path; polling is the
fallback. A missed webhook therefore delays the update, it does not lose it.

**Q: What if a webhook is delivered twice?**
The event is stored with a unique provider event id. The second delivery is
recognised as a duplicate and ignored. The business state is also moved through
a guarded transition, so a duplicate approval cannot apply twice.

**Q: What if someone sends a fake webhook?**
The webhook endpoint verifies the signature with the shared secret and compares
it in constant time. A request without a valid signature is rejected and
recorded as failed.

**Q: What if the user enters a fake company?**
The provider decision is the control. In sandbox, the scenario is fixed
(`approve`, `decline`, etc.) because the sandbox registry only knows one test
company. In production, the expected legal name and registration number are sent
to the provider, so a mismatch produces a decline or review.

**Q: Why does the demo show a Didit QR code instead of a desktop form?**
Didit's business KYB workflow is mobile-only for this configuration. The app
shows a QR code, the presenter scans it with a phone, completes the sandbox
scenario, and the status page updates. This is the provider's constraint, not a
NeoBank bug.

**Q: Why not just auto-approve in the demo?**
The local simulator can auto-approve, but production is deliberately configured
to use the real Didit provider. The simulator is disabled when Didit credentials
are present, so a demo cannot accidentally present a fake approval as real KYB.

**Q: What happens on a decline? Can the user try again?**
Yes. A decline is terminal for that attempt but not for the business. The user
can correct the profile and start a new attempt. Attempt numbers keep the history
auditable.

**Q: Where are the documents stored?**
They are not stored by NeoBank. They stay with Didit. NeoBank stores the
provider session id and the decision summary.

---

## 5. Module 2 — Roles and role-aware dashboards

### 5.1 What the user can do

- The same login page works for every role; there is no "login as admin" switch.
- The owner sees the full workspace: overview, team, account, transactions,
  cards, payments and approvals.
- An admin sees the same operator workspace, except owner-only controls such as
  changing roles, disabling members and changing the approval policy.
- An employee sees only their own card and their own payment requests. They do
  not see the business balance, the team list or the approval queue.
- Operations staff see the operational/ledger-integrity surface and cannot move
  money.

### 5.2 The role model

| Capability | Owner | Admin | Employee | Operations |
| --- | --- | --- | --- | --- |
| View business balance | Yes | Yes | No | No |
| View all transactions | Yes | Yes | No | No |
| List the team | Yes | Yes | No | No |
| Invite an employee/admin | Yes | Yes | No | No |
| Change a role / disable a member | Yes | No | No | No |
| Change the approval policy | Yes | No | No | No |
| Issue/freeze a card | Yes | Yes | Freeze own card only | No |
| See own card | Yes | Yes | Yes | No |
| Create a payment request | Yes | Yes | Yes | No |
| Approve/reject another person's payment | Yes | Yes | No | No |
| Read ledger integrity | No | No | No | Yes |

The important point: these are **server-side** checks. The UI hides pages for a
better experience, but hiding is not the security control. If an employee calls
`GET /api/v1/accounts/current` with a valid token, the API refuses.

### 5.3 How it is implemented

- `BusinessMember` is the single source of role and tenant membership. There is
  no second role system.
- The login response contains the role, but the role is re-read on each request
  from the membership row. A stale browser tab cannot keep a removed role alive.
- `authMiddleware(...)` receives the roles allowed for a route. The controllers
  declare their allowed roles next to the route, so the policy is visible in one
  place.
- `navForRole` in the frontend only decides what to render. It never decides
  what is allowed.

### 5.4 Likely questions and answers

**Q: Why not put the role in the JWT and avoid a database read?**
The role can change (promotion, demotion, disabling). A JWT is a snapshot. The
token is already re-checked against the membership row, so a disabled user loses
access immediately. The extra read is cheap and correct.

**Q: Can an employee just type `/dashboard/team` in the URL?**
They can load the page shell, but the page calls the team API, which returns
`403`, and the UI shows a refusal. More importantly, no data is returned.

**Q: Why does `OPERATIONS` exist?**
It separates "can see operational truth" from "can move money". The operations
role can inspect ledger integrity and webhooks but cannot approve payments or
issue cards. In a real bank, this is the maker-checker separation between
operations and treasury.

**Q: What if an owner is disabled?**
The current design prevents an owner from changing their own role or disabling
their own membership. The last owner is therefore not accidentally locked out.
A future version should add an explicit ownership-transfer flow.

**Q: What if two admins invite the same email?**
Only one live invitation per email is kept. Creating a new invitation revokes
the previous pending one inside the same transaction, so two links cannot both
work.

---

## 6. Module 3 — Account, wallet and double-entry ledger

### 6.1 What the user can do

- See the business USD account, ledger balance, holds and available balance.
- See a transaction list with each ledger movement and its entries.
- Open a single transaction and see the debit/credit lines.
- Operations can run a ledger integrity check.
- The browser cannot edit a balance. There is no "set balance" endpoint.

### 6.2 The two ledger accounts

Each business account has two ledger accounts:

| Code | Name | Type | Meaning |
| --- | --- | --- | --- |
| `1010` | `CUSTOMER_FUNDS` | Asset | The funds held for customers |
| `2010` | `WALLET` | Liability | What NeoBank owes the business |

This is a deliberately small model, not a full bank chart of accounts. It is
enough to prove balanced movement and to keep customer funds separate from the
wallet liability.

### 6.3 How money moves

**Deposit (sandbox funding):**

```
DEBIT   1010 CUSTOMER_FUNDS   $25,000.00
CREDIT  2010 WALLET           $25,000.00
```

The wallet balance (credits minus debits on `2010`) goes up by $25,000.

**Card capture or outbound payment:**

```
DEBIT   2010 WALLET           $73.40
CREDIT  1010 CUSTOMER_FUNDS   $73.40
```

The wallet balance goes down by $73.40. Total debits still equal total credits,
so the transaction is balanced.

**A card authorization does not post a ledger transaction.** It creates a
`Hold`. The ledger balance stays the same; the available balance becomes
`ledger balance - active hold remainder`.

### 6.4 Balance versus available balance

```
ledger balance    = sum(credits) - sum(debits) on the WALLET account
hold amount       = sum of (hold.amountMinor - hold.capturedMinor) for active holds
available balance = ledger balance - hold amount
```

Example after the seed:

- Ledger: $25,000.00 deposit - $84.20 capture - $12.50 capture = **$24,903.30**
- Active hold: **$120.00**
- Available: **$24,783.30**

This is why a card authorization can reduce "available" without changing the
"ledger" number. The money has not left yet; it is reserved.

### 6.5 Implementation protections

- `amountMinor` is a `BigInt` in the database and a string in JSON.
- A deferred constraint trigger checks that every transaction is balanced at
  commit time.
- A trigger rejects updates, deletes and truncates on ledger entries.
- Every ledger transaction has a `(businessId, idempotencyKey)` unique key and a
  request hash. Replaying the same key returns the original transaction; reusing
  the key with different data is refused.
- A reversal creates a new transaction that points at the original. Nothing is
  edited.
- Audit entries are written for money actions and team actions.

### 6.6 Likely questions and answers

**Q: What happens if I click "Pay" twice?**
For payment requests, the API derives an idempotency key from the client request
id and the request body. The second identical request returns the same payment
request instead of creating another one. If the user changes the amount, that is
a different instruction and a different key, so a second request is created —
which is correct, but each request still needs approval. The UI also disables
the button while the request is in flight.

**Q: What if two people approve the same payment at the same time?**
Approval runs in a database transaction and locks the request row
(`SELECT ... FOR UPDATE`). The first approver moves the status from
`PENDING_APPROVAL` to `COMPLETED` and posts the ledger transaction. The second
transaction then sees that the request is no longer pending and returns `409`.
The unique approval row `(paymentRequestId, actorUserId)` is a second guard.
Exactly one ledger payment is posted.

**Q: What if the approval succeeds but the ledger post fails?**
They are in the same database transaction. If the ledger post fails (for example,
insufficient funds), the approval row and the status change roll back too. The
request stays pending and can be retried.

**Q: Can someone edit a ledger row to fix a mistake?**
No. The database trigger rejects `UPDATE` and `DELETE`. A correction is a
reversal entry. This is intentional: an auditable money history is more valuable
than a convenient edit button.

**Q: Why is my available balance lower than my ledger balance?**
There is an active hold. A card authorization reserves the amount until the
merchant settles or the hold is released/expires.

**Q: What is the difference between a hold and a capture?**
A hold is a reservation. A capture is the actual money movement. A $50
authorization creates a $50 hold. If the merchant settles for $73.40, the ledger
posts $73.40 and the hold is released. The extra $23.40 comes from the available
ledger balance; this is the "tip at a restaurant" or "fuel pre-authorization"
case.

**Q: What if a hold expires?**
Expired holds stop reducing the available balance when balances are read. The
card module also handles provider expiry/void events by releasing the hold. A
settlement that arrives after expiry is treated as an exception; in a full bank
it would go to a reconciliation/ops queue. That queue is Module 6, which is not
built.

**Q: Do you store the balance as a column?**
No. The balance is computed from ledger entries. A stored balance can drift; a
computed balance cannot.

**Q: What prevents a negative wallet balance?**
An authorization or payment checks `availableMinor` inside the transaction. A
hold is only created when the available balance is sufficient. A payment posts
only when the wallet has funds. A card settlement can exceed the authorization
(this is a real card-network behaviour), so a small "authorised overdraft" is
possible in the card capture path; it is visible in the ledger and would need a
policy/credit decision in production.

---

## 7. Module 4 — Virtual cards with Lithic

### 7.1 What the user can do

- An owner/admin opens **Cards**, sees active employees, sets a monthly or
  per-transaction limit, and issues a virtual card.
- The employee sees the card on **My card**, including last four digits, expiry,
  status and spending limit.
- The owner/admin can freeze, unfreeze or cancel a card.
- The owner/admin can run a **sandbox merchant simulator**: authorization,
  clearing/settlement, refund and reversal.
- On the card detail page, the app now shows the **Lithic card id** (the
  `providerCardId`), which can be matched in the Lithic dashboard.

### 7.2 How card issuing works

1. The owner chooses an active employee.
2. NeoBank creates a Lithic **account holder** for that employee if one does not
   exist. Lithic returns an account holder token and an account token.
3. NeoBank creates a virtual card on that account with the requested spending
   limit.
4. NeoBank stores its own `Card` row with the provider card id and the provider
   account holder id.
5. The employee can now see the card. The provider card id is shown on the card
   detail page.

The card number/CVV is not stored by NeoBank. The demo only needs the virtual
card object and its lifecycle.

### 7.3 Authorization versus settlement

This is the most important card concept in the assignment.

```
1. Merchant requests $50.00
   -> Lithic sends an authorization event
   -> NeoBank approves if the card is active and available >= $50
   -> NeoBank creates a $50 hold
   -> Ledger balance: unchanged
   -> Available balance: -$50

2. Merchant settles $73.40 later
   -> Lithic sends a clearing event
   -> NeoBank posts a $73.40 CARD_CAPTURE ledger transaction
   -> The $50 hold is released
   -> The extra $23.40 comes from the wallet balance
```

The demo deliberately uses **$50 authorization / $73.40 settlement** so the
reviewer can see that a settlement is not a copy of the authorization.

The card detail page now has a **Settle amount** field for exactly this. Leave it
blank to settle the remaining hold; type `73.40` to demonstrate an over-capture.

### 7.4 Why the cards may not appear in the Lithic dashboard

The integration is not broken. Direct calls to the Lithic Sandbox API with the
configured key returned **3 cards and 4 account holders**, all created by this
app. The issue is how the dashboard is being viewed, not whether the cards exist.

Check these in order:

1. **Environment toggle.** The key is a Sandbox key
   (`https://sandbox.lithic.com/v1`). The Lithic dashboard must be switched to
   **Sandbox / Test mode**, not Production. A sandbox card never appears in the
   production view.
2. **Correct section.** Cards are under **Issuing → Cards**. Account holders are
   under **Issuing → Account holders** (or the equivalent "Cardholders" page).
   They are not under Payments, Transactions or Disputes.
3. **State filter.** The dashboard often defaults to showing only `OPEN` cards.
   In the sandbox account, one card was `CLOSED` and one was `PAUSED`. Clear the
   filter or explicitly include `PAUSED` and `CLOSED`.
4. **Workspace/program.** The dashboard login must be in the same workspace and
   program as the API key. If the key was created in a different workspace/
   program, the dashboard will look empty even though the API works.
5. **Search by token.** Copy the card id from the NeoBank card detail page
   ("Lithic card ...") and search for it in the dashboard. If the API returns
   that token but the dashboard search does not, the dashboard is in a different
   environment or workspace.
6. **The app list is our database, not the provider.** The Cards page reads
   NeoBank's `Card` rows. A card appears there because our create call succeeded
   and stored the provider id. To confirm the provider object, call
   `GET https://sandbox.lithic.com/v1/cards/{providerCardId}` with the same API
   key.

One more important distinction: the **sandbox merchant simulator** in the app
calls Lithic's sandbox simulation endpoint and then delivers a locally signed
webhook through the same ingestion path a real event uses. That proves our
webhook consumer and ledger behaviour. It does **not** mean Lithic is delivering
a real webhook to the deployed API. The event subscription is currently not
configured (`/v1/event_subscriptions` returns an empty list), so live provider
delivery is not claimed. Card creation itself is real against Lithic Sandbox.

### 7.5 Implementation notes

- All raw Lithic JSON is isolated in `lithic.client.ts`. The rest of the code
  speaks NeoBank vocabulary.
- `CardService` owns tenant checks, role checks, status mapping and the webhook
  event log.
- `LedgerService` owns holds, captures, refunds and reversals.
- A provider event can only ask the ledger to post. It cannot set a balance.
- The webhook path is idempotent by provider event id and provider authorization
  id. A repeated authorization does not create a second hold.
- A clearing that arrives before its authorization is parked and retried rather
  than dropped.
- A void/expiry releases the hold without posting a ledger transaction.
- A refund/reversal posts a new ledger transaction; it does not edit the
  original capture.

### 7.6 Likely questions and answers

**Q: Why do cards not show up in the Lithic dashboard?**
See the checklist above. The API proves the cards exist. The usual causes are
the Sandbox/Production toggle, the wrong workspace, or a default state filter
that hides `PAUSED`/`CLOSED` cards.

**Q: Is the card real?**
It is a real object in Lithic Sandbox. It is not a real-money card. The card
number is not stored by NeoBank.

**Q: What if the authorization is more than the available balance?**
The authorization is declined and recorded as `DECLINED`. No hold is created and
no ledger transaction is posted.

**Q: What if the card is frozen?**
The authorization is declined because `cardActive` is false. Freezing is a
provider status change plus a local status update.

**Q: What if the settlement is larger than the authorization?**
The ledger posts the actual settlement. The hold releases only what it reserved.
The difference comes from the wallet balance. This matches real card-network
behaviour (tips, fuel, hotels). It is visible in the ledger and in the card
authorization's `capturedMinor`.

**Q: What if the same webhook arrives twice?**
The provider event id is unique. The ledger also has an idempotency key per
authorization/capture. The second delivery is a no-op or a replayed result.

**Q: What if settlement arrives before authorization?**
It is parked and retried when the authorization arrives. This is exactly the
out-of-order case the brief asks about.

**Q: What if the provider is down?**
Card creation fails with a clear error; no half-card is stored. Webhook
processing is retried from the stored event. The demo does not claim automatic
provider failover.

**Q: Who can simulate a card spend?**
Owner/admin only. The employee cannot create a fake merchant authorization. In a
real deployment the merchant/network triggers it; in the demo the operator uses
the sandbox simulator.

---

## 8. Module 5 — Team, invitations, payments and maker-checker

### 8.1 What the user can do

- Owner/admin sees the team list with role, status and join date.
- Owner/admin invites a person as `EMPLOYEE` or `ADMIN`.
- The invitation is a one-time link. NeoBank does not send email; the demo
  copies the link and shares it.
- The invited person can open the link, sign in (or register with the invited
  email), and join the business.
- Owner can change a member's role or disable them.
- Owner can change the approval threshold.
- Employee creates a payment request. Above the threshold it waits for a second
  person; below the threshold it can auto-approve according to policy.
- A different owner/admin approves or rejects. The creator can cancel while it is
  pending.
- Approval posts exactly one balanced `PAYMENT` ledger transaction and marks the
  request `COMPLETED`.

### 8.2 Invitation flow

1. Owner/admin enters an email and chooses `EMPLOYEE` or `ADMIN`.
2. The API creates a random token, stores only its SHA-256 hash, and returns the
   raw link once.
3. The link expires after seven days. It is single-use and revocable.
4. A second invitation for the same email revokes the previous pending one.
5. When the link is opened, the API looks up the hash. The raw token is never
   stored, so a database leak does not expose working invitation links.
6. Accepting the invite creates or reuses the user and creates an `ACTIVE`
   membership. The role comes from the invitation, not from the client.

Ownership is never invited. A public registration creates an owner; invitations
can only grant `EMPLOYEE` or `ADMIN`. This prevents privilege escalation through
an invitation.

### 8.3 Payment flow and maker-checker

```
Employee creates payment request for $5,000
        |
        v
Threshold is $0 -> PENDING_APPROVAL (no ledger movement yet)
        |
        v
Owner/admin opens Approvals, sees the request
        |
        v
Different person approves
        |
        v
One database transaction:
  - lock the request
  - refuse self-approval
  - create the Approval row
  - post the PAYMENT ledger transaction
  - mark the request COMPLETED
  - write audit entries
```

The default seed policy is:

- `approvalThresholdMinor = 0`
- `requireSeparateApprover = true`

That means **every positive payment needs a second person**. This is deliberate:
it makes the maker-checker flow visible on first login and prevents the demo from
accidentally auto-approving everything.

### 8.4 Rules enforced in the service

- The creator can never approve their own request, even if they are the owner.
- Only `OWNER` and `ADMIN` can approve.
- An `AGENT` actor type can never approve (this is the hook for Module 7).
- The request must be `PENDING_APPROVAL`; a decided request returns `409`.
- The approver must be an active member of the same business.
- Approval and ledger posting are in the same database transaction.
- A unique `(paymentRequestId, actorUserId)` approval row prevents duplicates.
- Rejection and cancellation are terminal and post no money.
- A payment request uses an idempotency key derived from the client request id
  and the body, so a double-click does not create two requests.

### 8.5 Likely questions and answers

**Q: What if I click "Pay" twice?**
The second identical creation returns the existing request. The approval step
still needs a human, and a double approval returns `409`. No second ledger
payment is posted.

**Q: What if the same person tries to approve their own request?**
The service checks `createdByUserId === actorUserId` before anything else and
returns `403`. This applies to owners too. The UI also hides the approve button
for the creator, but the server check is the real control.

**Q: What if two approvers click at the same time?**
The request row is locked. The first transaction wins and posts the payment. The
second sees a non-pending status and returns `409`. There is exactly one payment.

**Q: What if the payment is below the threshold?**
The policy auto-approves it and posts the ledger transaction in the same
transaction. The approval record is marked as a policy decision, not a human
approval. The UI explains that the threshold is a policy, not a way to bypass
maker-checker.

**Q: Can an admin change roles or disable people?**
No. Those are owner-only actions. An admin can invite and approve payments, but
cannot change the ownership/role structure.

**Q: Can an employee see the team or the approval queue?**
No. The team and approval endpoints require admin/owner roles, and the employee
navigation does not include them.

**Q: What if an invitation expires?**
The API returns an expired state. The owner can resend/rotate the link, which
creates a new token and extends the expiry. The old link stays dead.

**Q: What if the invited email already has an account?**
The person signs in with that account and accepts. The membership is created for
the business from the invitation. The role is taken from the invitation.

**Q: Is the payment rail real?**
No. It is a clearly labelled simulator. Approval posts the internal `PAYMENT`
ledger transaction. No ACH, wire, Plaid or bank transfer is claimed. This is a
deliberate boundary, and it is stated in the UI and submission.

**Q: Why not use a real payment rail?**
The assignment allows a simulated payment rail when a real one is not available,
and the provider credentials/region made a real rail impractical in the time
box. The honest label is better than pretending a simulator is a bank transfer.
The card integration (Lithic) and KYB (Didit) are the real provider integrations.

---

## 9. Modules 6 and 7 — not built

These are stated here so the boundary is clear.

### Module 6 — Statements, reconciliation and operations

Planned scope:

- Generate account statements for a period.
- Import a provider settlement file and match it to ledger entries.
- Classify breaks: missing in ledger, missing at provider, amount mismatch,
  duplicate, timing difference.
- A bitemporal correction model: what we knew, when we knew it, and what the
  provider says now.
- Operations queues for unresolved breaks and provider health.
- A daily close/reconciliation run with an audit trail.

Why it is not built: Modules 1–5 establish the money system and the provider
events. Reconciliation is a large surface, and a shallow version would be worse
than an honest boundary. The plan and data model are in `planning/feature5.md`.

### Module 7 — MCP agent surface

Planned scope:

- Three read tools (balance, transactions, card status) and one safe write tool
  that creates a payment request in the human approval queue.
- The agent can never approve. Approval requires a human owner/admin.
- Every agent action is audited with `actorType = AGENT`.

Why it is not built: it depends on the same ledger and approval queue, and the
safe-write boundary is only credible once the human flow is solid. The payment
service already refuses `actorType !== "USER"` in approval, which is the
foundation for this module.

---

## 10. System design decisions

| Decision | Why | Trade-off |
| --- | --- | --- |
| Modular monolith | One transaction can cover approval + ledger + audit | Less independent scaling than microservices |
| PostgreSQL + Prisma | Strong constraints, transactions, migrations, hosted Neon | Not a ledger database; very large scale would need partitioning |
| Integer cents as strings | No floating point, safe JSON transport | Every client must parse strings, not numbers |
| Double-entry ledger | Balance is provable and auditable | More rows and more code than a single balance column |
| Append-only entries with triggers | History cannot be silently edited | Corrections require reversal transactions |
| Holds for card authorizations | Available balance reflects reserved funds | Holds need expiry and reconciliation |
| Backend role checks | Hiding UI is not security | More explicit middleware per route |
| Derived onboarding state | No stored state machine that can drift | Status logic must be tested carefully |
| Provider adapters | Didit/Lithic details stay in one place | More interface code up front |
| Idempotency keys everywhere | Real webhooks and users retry | Keys and request hashes must be stored |
| Label the payment rail as a simulator | Honest integration claim | Lower "live money rail" score than a real rail |
| No card PAN storage | Reduces PCI scope | The demo cannot show a full card number |

### Why the ledger is the core

Cards, payments, balances and reconciliation all depend on the ledger. If the
ledger is wrong, every screen above it is wrong. That is why the build order was:

```
KYB -> roles -> ledger -> cards -> payments/approvals -> (reconciliation) -> (MCP)
```

The order follows dependency and grading risk, not screen count.

---

## 11. Scaling questions and answers

These are the "what if this had 10x/100x users?" questions.

**Q: What breaks first at 10x traffic?**
Probably the API/database connection pool and the synchronous webhook handling.
The first fixes are: a queue for webhook ingestion, a larger pooled connection
limit, and moving read-heavy dashboard queries to a read replica.

**Q: How would you scale webhook ingestion?**
Put the raw event in a durable queue (SQS/Redis Streams/Kafka) and acknowledge
quickly. A worker verifies, stores and processes with the same idempotency keys.
This decouples provider bursts from the API and makes retries safe.

**Q: How would you scale the ledger?**
Partition `LedgerEntry` and `LedgerTransaction` by business or by month. Keep the
hot "current balance" as a materialized snapshot updated in the same transaction,
with periodic rebuilds from entries. Use a read replica for statements and
history. Never use the replica for the authorization decision.

**Q: How would you handle millions of businesses?**
Tenant-aware indexes already exist on `businessId`. Add partitioning and
archival per tenant, and move very large tenants to dedicated databases
("cells"). A single Postgres instance is fine for a demo, not for a global bank.

**Q: How would you scale card authorizations?**
Authorizations are latency-sensitive. Keep the decision in memory/cache for
limits and card status, but always verify the available balance against a
transactional store. Use a fast, regional database for the hot path and reconcile
asynchronously. The current code is correct, not optimized.

**Q: How would you handle multiple currencies?**
The account model is already keyed by `(businessId, currency)`. The ledger
entries carry a currency. The missing pieces are FX rates, per-currency
reconciliation and a policy for cross-currency payments.

**Q: How would you handle multiple regions?**
Run regional cells with a local database and a global identity/tenant directory.
Card and payment data should stay in the region required by regulation. This is
a much larger compliance project than a schema change.

**Q: How would you scale the team/approval flow?**
The approval transaction already locks one request. At high volume, shard by
business and keep the lock scope small. Notifications would move to a queue.
Approval policies could become per-department or per-amount rules.

**Q: How would you make the payment rail real?**
Add a provider adapter (for example Modern Treasury, Increase, Column or a bank
API) behind the same `PaymentService` seam. Keep the ledger as the book of
record, use the provider's idempotency key, and reconcile provider status
asynchronously. The current simulator is intentionally isolated so this swap does
not touch the ledger.

**Q: How would you handle 100k webhooks per minute?**
Queue + workers + idempotent writes + backpressure. The API only stores the raw
event; the worker does the state transition. Add dead-letter queues and replay
tooling. The current code already stores the event and has a status field, which
is the right starting shape.

**Q: How would you monitor this in production?**
Request logs already carry a request id. Add metrics for authorization approval
rate, webhook lag, ledger integrity failures, approval queue age, provider error
rate, and payment failure rate. Alert on integrity failure and on a stuck
webhook/reconciliation queue.

**Q: What about rate limiting and abuse?**
Login and registration already have rate limiters. Add per-business and
per-IP limits on payment creation, card issuance and invitation creation. Add
audit-based anomaly detection for unusual payment amounts or approval patterns.

**Q: What about security at scale?**
Short-lived access tokens, rotating refresh tokens, hardware-backed secrets,
per-tenant encryption keys, strict CORS, CSRF protection for cookie auth (the
cookie is `__Host-` and `SameSite`), audit log immutability, and a secrets
manager. The demo already uses hashed invitations, hashed passwords, signed
webhooks and constant-time signature comparison.

**Q: What about compliance?**
KYB/KYC, sanctions screening, transaction monitoring, record retention, data
residency, PCI scope for cards, and SOC 2-style controls. The demo is a product
slice, not a regulated bank. The honest boundary is part of the submission.

---

## 12. Rapid-fire "what if" questions

**What if the user closes the browser during onboarding?**
The state is in the database. On return, the app reads the business and the
latest verification attempt and resumes at the right step.

**What if the user refreshes after starting verification?**
The same active attempt is returned. A second click does not create a second
provider session.

**What if the provider sends a decision for an old attempt?**
The transition checks the attempt and refuses to let a stale decision overwrite a
newer terminal state.

**What if the database goes down mid-request?**
The transaction rolls back. The client gets an error and can retry with the same
idempotency key.

**What if the API crashes after the provider charge but before the database
commit?**
For card events, the raw event is stored before processing, so it can be
replayed. For the demo, the provider simulation is synchronous; a production
system would rely on the provider's event retry plus the stored event.

**What if someone steals a token?**
The token is checked against the membership row and a blacklist. A disabled
member or logged-out token stops working. Production would add short expiry,
refresh rotation and device/session management.

**What if an employee is disabled while logged in?**
The next authenticated request re-reads the membership and refuses. The browser
session does not keep access.

**What if a business is suspended?**
Money movement and card issuing check `business.status === ACTIVE`. A suspended
business can still sign in and see its state, but cannot transact.

**What if a payment is approved but the beneficiary is wrong?**
The payment is a simulator; there is no real beneficiary. In a real rail, a
wrong beneficiary is an operations/reconciliation issue, not something the
ledger can silently fix. A reversal or recall would be a new transaction.

**What if two payments try to spend the same money?**
Both check available balance inside their own transaction. One wins; the other
gets insufficient funds. The ledger never goes negative through the payment
path.

**What if a card settlement exceeds the wallet balance?**
The capture path posts the actual settlement and can create a negative wallet
balance. This is a real card-network behaviour and is visible in the ledger. A
production bank would have a credit/overdraft policy and an ops queue.

**What if the merchant refunds after the card is closed?**
The refund is a new ledger transaction; closing a card does not erase history.
The demo supports refunds/reversals on the card detail page.

**What if the same invitation link is opened twice?**
It is single-use. The first acceptance marks it `ACCEPTED`; the second is
refused. The owner can resend a new link.

**What if an invitation is sent to the wrong email?**
The owner revokes it. The link stops working immediately.

**What if the last owner wants to leave?**
The current build blocks an owner from changing their own role or disabling
themselves. A real product needs an ownership-transfer flow; that is a known
gap, not a hidden one.

**What if the approval threshold is set to zero?**
Every positive payment needs approval. The seed uses zero deliberately so the
maker-checker flow is visible.

**What if the approval threshold is very high?**
Payments below it auto-approve by policy. The creator still cannot approve their
own request; the policy does it, and the audit log records that it was a policy
decision.

**What if an admin tries to approve their own request?**
Refused, same as an owner. The rule is about the person, not the role.

**What if a request is rejected?**
It is terminal and posts no money. The creator can create a new request.

**What if a request is canceled?**
Only the creator can cancel while it is pending. It is terminal and posts no
money.

---

## 13. Live demo questions Corgi may ask

These are the questions most likely to come up while you are showing the app.

**Onboarding**

- "What happens if I don't verify the business?" — The account, cards and money
  routes return `409`; the dashboard stays gated.
- "Is this real KYB?" — It is Didit Sandbox. The decision is not a real
  regulatory approval, but the integration and the signed webhook path are real.
- "Why the QR code?" — Didit's business workflow is mobile-only in this
  configuration. Scan it, complete the sandbox scenario, and the status page
  updates.
- "What if the webhook is delayed?" — The status page polls the provider as a
  fallback.

**Team**

- "Can an employee see the balance?" — No. The API returns `403`, even if they
  call it directly.
- "Can an admin change roles?" — No. Role changes and disabling are owner-only.
- "What happens if I invite someone?" — A one-time, hashed, seven-day link is
  created. NeoBank does not send email; you copy the link.
- "Can an invitation create an owner?" — No. Invitations can only grant
  `EMPLOYEE` or `ADMIN`.

**Ledger**

- "Where is the balance stored?" — It is computed from ledger entries. There is
  no editable balance column.
- "What happens if I click pay twice?" — Idempotency returns the existing
  request; approval still needs a human; a duplicate approval returns `409`.
- "What if two people approve at once?" — The request row is locked; exactly one
  ledger payment is posted.
- "Can you edit a transaction?" — No. Entries are append-only; corrections are
  reversals.
- "Why is available lower than ledger?" — An active card hold is reserving
  money.

**Cards**

- "Why don't I see the card in Lithic?" — Check Sandbox mode, Issuing → Cards,
  the state filter, and the workspace/program. The app now shows the Lithic card
  id so you can search for it.
- "Is the card real?" — It is a real Lithic Sandbox object, not a real-money
  card.
- "What if the settlement is different?" — The ledger posts the actual
  settlement; the hold releases; the difference comes from the wallet.
- "Who triggers the authorization?" — In production the merchant/network does.
  In the demo, the owner/admin uses the sandbox simulator. The employee cannot
  fake a merchant charge.

**Payments**

- "Is this ACH?" — No. It is a clearly labelled simulator. The ledger and
  approval logic are real; the rail is not.
- "Can the creator approve?" — Never. `403`.
- "What if the approver is in another tenant?" — The request is scoped to the
  business; a foreign id returns `404`, and a foreign membership cannot approve.
- "What if the payment is below the threshold?" — Policy auto-approves it and
  posts the ledger transaction; the audit log records the policy decision.

**General**

- "Why only five modules?" — The first five establish the money system and the
  two provider integrations. Modules 6 and 7 are scoped but not built; the
  submission says so.
- "What would you build next?" — Reconciliation and operations first, then the
  MCP read tools and the safe payment-request write.
- "What is the biggest risk?" — The payment rail is simulated and live provider
  webhook delivery is not configured. Both are stated openly. The ledger,
  idempotency and maker-checker are the strongest parts.

---

## 14. Short glossary

- **KYB** — Know Your Business. Verifying that a company is real and legitimate.
- **KYC** — Know Your Customer. Verifying a person's identity.
- **Ledger** — The record of every money movement as balanced debits and credits.
- **Entry** — One side of a ledger transaction (debit or credit).
- **Hold / authorization** — A temporary reservation of funds, usually from a
  card. It reduces available balance but does not post to the ledger.
- **Capture / clearing / settlement** — The merchant actually taking the money.
  It posts the ledger transaction.
- **Maker-checker** — One person creates a payment, a different person approves
  it.
- **Idempotency** — Doing the same operation twice has the same effect as doing
  it once.
- **Webhook** — An HTTP callback from a provider telling us something happened.
- **Sandbox** — A provider's test environment. No real money moves.
- **MCP** — Model Context Protocol. A standard way to expose tools to an AI
  agent. Not built in this submission.
