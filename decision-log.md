# Decision log

Timestamped as the work happened. Newest at the bottom. Entries are written
when a choice is made, not reconstructed at the end.

## 2026-11-03T07:55Z — Track and scope

- Track 3 (Neobank), 48-hour window. One business account, USD only, virtual
  cards only.
- The build order is ledger and hold model first, then card authorisation
  lifecycle, then payments/maker-checker, then reconciliation and MCP. UI
  breadth is deliberately cut; financial correctness is not.
- Kept the existing Express + Inversify template rather than rewriting it: the
  DI, validation and error-handling seams are worth more than a new skeleton.

## 2026-11-03T08:05Z — Auth foundation and roles

- Kept `User` + `BlacklistToken` only. Financial models are added per module so
  the ledger is designed around events, not dashboard pages.
- Business roles: `OWNER`, `ADMIN`, `EMPLOYEE`, `OPERATIONS`. `OPERATIONS` can
  read webhooks/ledger/breaks and never move money.
- Public registration always creates `OWNER`. A caller cannot pass a role;
  team roles are assigned later by an `OWNER`/`ADMIN`. Initiator/approver is a
  permission check at the payment, not a fifth role.
- Deleted every leftover from the imported template: tournaments, testing
  ranks, notifications, avatars/uploads, MinIO, user list/delete/restore.

## 2026-11-03T08:20Z — Tokens and cookies

- JWT carries `userId`, `role` and `tokenVersion`. `tokenVersion` is the
  logout-all / soft-delete lever so an old token stops working without a
  session table.
- Logout blacklists the exact token until its own `exp`; clearing the cookie is
  not treated as logout.
- The API accepts `Authorization: Bearer` or an httpOnly cookie. In production
  the cookie is `Secure` + `SameSite=None` because Vercel/Netlify and Render are
  different sites.
- Unknown email and wrong password return the same 401 shape to avoid account
  enumeration.

## 2026-11-03T08:31Z — Structured logging: Pino, not Winston

- Chose **Pino** over Winston. Reasons: JSON is the default (not a transport
  configuration), lower per-line overhead on a small Render instance,
  `pino-http` gives request logs and `genReqId` out of the box, and redaction is
  declarative.
- Kept the existing `Logger` class API so services still call
  `logger.info(message, meta)`; the class is now a thin wrapper over one Pino
  instance. No call site knows about Pino.
- Request id is assigned by `pino-http`, reused from `x-request-id` when
  present, echoed on the response, and attached to application logs through
  `AsyncLocalStorage` (`requestId`, `ip`, `userId`).
- Authorization/cookie headers and password/token fields are redacted at the
  logger, not left to each call site.
- Health checks are excluded from access logs so uptime probes do not bury
  real traffic.
- Winston would be acceptable if the team already standardised on it; it buys
  nothing extra for stdout JSON here.

## 2026-11-03T08:36Z — Boot-time environment validation

- Added `src/config/env.ts`: Joi validates `process.env` once, at import time.
  Missing `DATABASE_URL`, a `JWT_SECRET` under 32 chars, or a bad port stops the
  process with a readable message instead of failing on the first request.
- No module reads `process.env` directly after this; they import typed `env`.
  The one exception is tooling (`prisma.config.ts`, seed), which runs outside
  the app.

## 2026-11-03T08:42Z — Netlify deployment shape

- Next.js 16 on Netlify uses the OpenNext runtime (zero config, SSR/route
  handlers/dynamic routes supported). No publish directory needs to be pinned.
- Therefore the classic SPA catch-all `/* /index.html 200` is **not** enabled:
  it would shadow every server-rendered route. `public/_redirects` documents
  the rule and keeps it commented, to be enabled only if the app switches to
  `output: "export"`.
- Site should be created with base directory `frontend` (monorepo layout).

## 2026-11-03T09:02Z — Transport hardening

- `helmet` with `Cross-Origin-Resource-Policy: cross-origin`: the API is a
  different origin from the Netlify site, and a stricter policy would make the
  browser refuse the JSON response. `x-powered-by` is disabled.
- `compression()` for JSON above ~1 KB. Financial lists (ledger entries,
  transactions) are the responses that will actually benefit.
- Rate limits are split by intent instead of one global bucket: 300 requests /
  15 min for the API, 10 *failed* logins / 15 min, 10 registrations / hour.
  Successful logins do not consume the login budget, so a normal user cannot
  lock themselves out by working.
- Health checks are exempt from the API bucket, otherwise a 30-second uptime
  probe would exhaust it and make the service look down to real traffic.
- Store is in-memory deliberately: one Render instance is the deployment
  target. If it scales horizontally, the store moves to Redis and nothing else
  changes.

## 2026-11-03T09:10Z — Frontend API client

- One Axios instance (`frontend/lib/api.ts`) instead of `fetch` per component:
  base URL, credentials, timeout, request id and error normalisation live in
  one place.
- `withCredentials` is on for the httpOnly cookie, but the Bearer token is also
  kept in `localStorage`. Netlify and Render are different sites, and
  third-party cookie blocking makes cookie-only auth unreliable in some
  browsers. This is a trial trade-off, not the production design — production
  would use a first-party API domain or a refresh-token rotation scheme.
- Every request sends `x-request-id`; the backend already echoes it and logs it,
  so a user-visible failure can be traced to its exact server log lines.
- API errors are converted to `ApiClientError` (`status`, `isUnauthorized`) in
  the response interceptor, so UI code never imports Axios types.
- `authApi` owns token sync: login/register store the token, logout clears it
  in a `finally` so the UI logs out even when the network call fails.

## 2026-11-03T09:20Z — Business domain and role ownership

- Added `Business`, `BusinessMember` and `Verification`, and **moved the role off
  `User` onto `BusinessMember`**. A user is not "an ADMIN" in the abstract; they
  are an ADMIN of a specific business. Keeping the role on `User` would have
  forced a migration later, when real memberships exist.
- Registration is now one transaction: `User` + `Business` + `OWNER` membership.
  A user without a business, or a business without an owner, is not a state the
  API can produce.
- The JWT carries `businessId` in addition to `userId`/`role`, and
  `authMiddleware` re-reads the membership on every request. Removed members and
  role changes therefore take effect immediately; the token is not trusted on
  its own.
- New businesses start `PENDING_VERIFICATION` but **can still sign in**, so the
  onboarding/KYC screens are reachable. `SUSPENDED`/`CLOSED` are rejected at
  auth; money-moving routes will add an explicit `ACTIVE` check rather than
  hiding the whole workspace.
- The demo seed creates one ACTIVE business (`NeoBank Demo Co`) with all four
  roles, so maker-checker and OPERATIONS views can be exercised immediately.
- `Verification` is a row per attempt, not fields on `Business`: a rejected
  applicant re-submits, and the earlier decision has to stay auditable.
  `providerApplicantId` is unique because it is the Sumsub webhook idempotency
  key.
- The local database was reset (user-approved) and the first migration
  (`20261103093000_init`) was generated and applied. From here schema changes go
  through `prisma migrate`, not `db push`, so deployments have history.

## 2026-11-03T10:40Z — KYB provider: Didit Sandbox instead of Sumsub

- Switched the KYB provider to **Didit**, in **Sandbox** mode. Sumsub's
  self-service signup requires a corporate email domain, and we only have a
  personal address, so the Sumsub account could not be created at all. Blocking
  Module 1 on a vendor signup we cannot complete is worse than switching.
- Didit was chosen over other alternatives because it matches the shape of the
  flow we already designed: a backend-created session returns a hosted
  verification URL, the provider posts `status.updated` webhooks, and a sandbox
  application reproduces deterministic Approved/Declined/In Review outcomes. No
  new domain concepts were needed.
- **The provider seam is unchanged.** `Verification` still stores a provider
  reference per attempt, and the integration lives behind a
  `VerificationProvider` interface (`createSession`, `getDecision`,
  `parseWebhook`). Swapping Didit for a real KYB provider later means adding an
  implementation and one enum value, not rewriting the module.
- **No SDK token endpoint.** Didit's hosted flow is a plain URL, so the Sumsub
  "create applicant → mint short-lived SDK token → load WebSDK" sequence
  collapses into "create session → open URL". The desktop path renders that URL
  as a QR code so the user can finish on a phone. Fewer endpoints, no SDK script,
  no token refresh callback.
- **The EIN is dropped entirely.** Didit's KYB prefill takes `company_name`,
  `registry_country` (`US-CA` for US state registries) and
  `registration_number`; it never asks us for an EIN. The earlier plan collected
  a full EIN in memory and persisted `einLast4`. That was a workaround for a
  provider requirement that no longer exists, so the form does not ask for one
  and `Business.taxId` is removed rather than repurposed. Less sensitive data
  means less to leak, log or redact.
- **`Business.status` and `Verification.status` stay separate**, and the split
  is the module's core invariant:
  - `Business.status` answers "may this business transact?" —
    `PENDING_VERIFICATION`, `ACTIVE`, `REJECTED` (plus the ops-only `SUSPENDED`
    and `CLOSED` already in the schema).
  - `Verification.status` answers "what did the provider say about *this*
    attempt?" — `NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED`, `REVIEW`.
  A business can be `PENDING_VERIFICATION` while its verification is `REVIEW`,
  and a rejected attempt never mutates the previous attempt's row. Collapsing
  them into one column would make a retry erase the audit trail.
- **Status vocabulary narrowed to five values.** `ON_HOLD` is renamed `REVIEW`,
  and Didit's `Abandoned`/`Expired`/`Kyc Expired` collapse into `REJECTED` for
  the attempt while the business stays `PENDING_VERIFICATION`, because those are
  retryable non-decisions, not refusals. The raw provider string is kept in
  `providerStatus` so the distinction is never lost.
- **Sandbox is a first-class database fact.** `Verification.environment`
  (`SANDBOX`/`LIVE`) and `sandboxScenario` are stored, returned by the API, and
  rendered as a banner. A demo approval must never be mistakable for a real KYB
  result, in the database or on screen.
- **Webhook verification uses the body-covering signatures.** `X-Signature`
  over the exact raw bytes first, then `X-Signature-V2` over canonical JSON
  (sorted keys, compact separators, preserved Unicode). `X-Signature-Simple` is
  deliberately not accepted: it authenticates only four envelope fields and
  says nothing about `decision`. The `-Previous` headers are accepted for 24h so
  a secret rotation does not take the endpoint down.
- **Idempotency keys off `event_id`, not a hash.** Didit sends a stable UUID and
  reuses it on retries, which is exactly the `@@unique([provider,
  providerEventId])` constraint we wanted. The earlier semantic-hash fallback is
  now only a defensive path for a malformed payload.
- **Ordering is explicit.** Delivery order is not guaranteed, so
  `providerCreatedAt` (from Didit's `created_at`) is stored and an older event
  never overwrites newer state. When a decision matters, the decision endpoint
  is re-fetched rather than trusted from the body.
- Cost of the switch: one new vendor account, and the sandbox URLs/statuses are
  now Didit's rather than Sumsub's. Everything downstream — onboarding state
  machine, RBAC, `WebhookEvent`, `AuditLog`, the gate that keeps unverified
  businesses out of money routes — is provider-independent and unchanged.

## Open assumptions

- Didit sandbox and Stripe Issuing test mode both remain unverified on this
  account; if Issuing is unavailable, swap the `CardIssuingProvider`
  implementation to Lithic without touching the domain model.
- Card/payment provider webhooks will be exercised from the deployed Render
  URL, not localhost, so signature verification is tested against the real
  delivery path.
