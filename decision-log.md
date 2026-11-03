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

## Open assumptions

- Sumsub sandbox and Stripe Issuing test mode both remain unverified on this
  account; if Issuing is unavailable, swap the `CardIssuingProvider`
  implementation to Lithic without touching the domain model.
- Card/payment provider webhooks will be exercised from the deployed Render
  URL, not localhost, so signature verification is tested against the real
  delivery path.
