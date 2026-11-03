# NeoBank — Backend

Express + TypeScript API for the Corgi Neobank work trial (Track 3). Built so far:

- **Identity & auth** — register, login, profile, logout
- **Business domain** — `Business`, `BusinessMember` (roles), `Verification`

The ledger, card, payment and reconciliation modules are added next, on top of
these models.

## Stack

| Concern    | Choice                                        |
| ---------- | --------------------------------------------- |
| Runtime    | Node.js 22+ (ESM, native `.ts` via `tsx`)     |
| HTTP       | Express 4 + `inversify-express-utils`         |
| Database   | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)  |
| Auth       | JWT (Bearer) + httpOnly cookie, bcrypt hashes |
| Logging    | Pino (JSON) + `pino-http`, request-correlated |
| Validation | Joi at the boundary + boot-time env schema    |

## Data model

| Model            | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `User`           | Person + credentials. No role, no financial data.                    |
| `Business`       | The customer entity that will own accounts, cards and money.         |
| `BusinessMember` | `(business, user)` join **and the only place a role lives**.         |
| `Verification`   | KYC/KYB attempt (Sumsub applicant, status, provider payload subset). |
| `BlacklistToken` | Logged-out JWTs kept until their own `exp`.                           |

Registration writes the user, the business and the `OWNER` membership in one
transaction: an account without a business, or a business without an owner, is
not a valid state.

## Roles

Roles live on `BusinessMember`, so the same person can be an ADMIN at one
business and an EMPLOYEE at another:

| Role         | Meaning                                                               |
| ------------ | --------------------------------------------------------------------- |
| `OWNER`      | Registered the business; owns account, team, cards and approvals      |
| `ADMIN`      | Manages team/cards and can approve payments                           |
| `EMPLOYEE`   | Uses an assigned card, initiates payment requests                     |
| `OPERATIONS` | Platform operator: reads webhooks/ledger/breaks; never moves money    |

Public registration always creates an `OWNER` **membership**. A client can never
self-assign a role; team members are assigned by an `OWNER`/`ADMIN`. The
initiator/approver split is a permission check, not a separate role: an approver
can never approve their own request.

The JWT carries `userId`, `businessId`, `userRole` and `tokenVersion`. Every
protected request re-reads the membership, so a removed member or changed role
takes effect immediately rather than at token expiry.

## Quick start

```bash
cp .env.example .env      # fill DATABASE_URL + a long JWT_SECRET
npm install
npm run db:migrate        # apply prisma/migrations
npm run db:seed           # optional: demo business + users
npm run dev               # http://localhost:5000
```

`npm run build && npm start` runs the compiled output from `dist/`.

### Database

Any PostgreSQL works (local, Docker, Neon). Point `DATABASE_URL` at it:

```bash
docker run --name neobank-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=neobank \
  -p 5432:5432 -d postgres:16-alpine
```

For Neon, use the pooled URL for the app and the direct URL for migrations if
your setup requires it.

### Demo users (`npm run db:seed`)

All four belong to **NeoBank Demo Co** (USD, ACTIVE).

| Email                 | Role         | Password      |
| --------------------- | ------------ | ------------- |
| `owner@neobank.dev`   | `OWNER`      | `NeoBank@123` |
| `admin@neobank.dev`   | `ADMIN`      | `NeoBank@123` |
| `employee@neobank.dev`| `EMPLOYEE`   | `NeoBank@123` |
| `ops@neobank.dev`     | `OPERATIONS` | `NeoBank@123` |

## API

Base path: `/api/v1`. Every response is `{ data, success }` on success and
`{ message, success: false }` on failure.

| Method | Path              | Auth | Body / notes                                    |
| ------ | ----------------- | ---- | ----------------------------------------------- |
| GET    | `/health`         | —    | `{ status: "ok" }`                              |
| POST   | `/auth/register`  | —    | `{ username, email, password, businessName?, country? }` → creates business + OWNER membership |
| POST   | `/auth/login`     | —    | `{ email, password }` → `{ user, token }`       |
| GET    | `/auth/profile`   | Yes  | current user, role and business                 |
| POST   | `/auth/logout`    | Yes  | blacklists the presented JWT and clears cookie  |

Auth accepts either `Authorization: Bearer <token>` or the `token` httpOnly
cookie set by register/login. Logout requires a valid token.

`user` in auth responses:

```json
{
  "id": "cmw0...",
  "username": "owner",
  "email": "owner@neobank.dev",
  "role": "OWNER",
  "business": {
    "id": "cmw0...",
    "legalName": "NeoBank Demo Co",
    "currency": "USD",
    "status": "ACTIVE"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

New registrations start with `business.status = PENDING_VERIFICATION`; the
business can sign in and finish onboarding, but money-moving routes will require
`ACTIVE`.

### Example

```bash
curl -s http://localhost:5000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@neobank.dev","password":"NeoBank@123"}'

curl -s http://localhost:5000/api/v1/auth/profile \
  -H "authorization: Bearer <token>"
```

Status codes: `201` register, `200` read/OK, `400` validation, `401` missing or
invalid/blacklisted token, `403` deleted account / no membership / suspended
business, `409` duplicate email/username.

## Logging

Pino emits one structured JSON object per line in production; locally (TTY) it
pretty-prints. `pino-http` logs every completed request with status code and
latency, and silently skips `/api/v1/health`.

```json
{"level":"info","time":"2026-11-03T08:18:01.986Z","service":"neobank-api","env":"production","requestId":"9633db21","ip":"203.0.113.7","userId":"cmw0...","msg":"user logged in"}
```

- `requestId` comes from `x-request-id` (or is generated) and is echoed back on
  the response, so a user report can be matched to its log lines.
- Every application log inside a request gets `requestId`, `ip` and `userId`
  from `AsyncLocalStorage`; call sites never pass them.
- `authorization` / `cookie` headers and `password` / `token` fields are
  redacted at the logger, not at each call site.
- `LOG_LEVEL` (`fatal|error|warn|info|debug|trace`) controls the floor.
- Errors are logged with `{ err }` so Pino prints the stack once, structured.

Why Pino over Winston: JSON-first by default, ~5x lower overhead per line, a
request logger (`pino-http`) and redaction built in, and no transport plumbing
for stdout on Render. Winston is fine if a team already standardises on it, but
it is a heavier dependency for the same output here.

## Environment validation

`src/config/env.ts` validates `process.env` with Joi at import time. A missing
`DATABASE_URL`, a short `JWT_SECRET`, or a bad `PORT` stops the process with a
readable message before any route can serve traffic. Every module reads the
typed `env`, never `process.env`.

## Scripts

| Script                | What it does                              |
| --------------------- | ----------------------------------------- |
| `npm run dev`         | watch mode on `src/server.ts`             |
| `npm run build`       | `prisma generate` + `tsc` → `dist/`       |
| `npm start`           | run the compiled server                   |
| `npm run typecheck`   | `tsc --noEmit`                            |
| `npm run db:push`     | push schema without a migration           |
| `npm run db:migrate`  | create/apply a dev migration              |
| `npm run db:seed`     | idempotent demo users                     |
| `npm run db:studio`   | Prisma Studio                             |

## Layout

```
src/
├── config/        env + env validation, DI container, Prisma lifecycle
├── constants/     status codes, roles, error copy
├── controllers/   HTTP surface (auth only for now)
├── middlewares/   auth, request context
├── repositories/  persistence (no business rules)
├── services/      business rules
├── types/         DTOs + DB contracts
├── utils/         JWT, logger, ApiError, request context
└── validators/    Joi schemas
prisma/
├── schema.prisma  User, Business, BusinessMember, Verification, BlacklistToken
├── migrations/    versioned SQL (apply with `npm run db:migrate`)
└── seed.ts        demo business + users
```

## Security notes

- Passwords are hashed with bcrypt (10 rounds) and never returned by queries.
- `password` is omitted client-wide; only the login read opts back in.
- Tokens carry `tokenVersion`, so soft delete / logout-all invalidates old JWTs.
- The JWT is scoped to one business (`businessId`) and the membership is
  re-checked on every request: removing a member, changing their role or
  suspending the business revokes access immediately.
- Logout blacklists the exact token until its `exp`.
- Cookie is `httpOnly`; `secure` + `SameSite=None` in production because the
  frontend is on a different origin than the API.
- `CORS_ORIGIN` is an allow-list; never commit a real `JWT_SECRET`.
- `helmet` sets security headers; `x-powered-by` is disabled and
  `Cross-Origin-Resource-Policy` is `cross-origin` for the Netlify frontend.
- `compression` gzips JSON responses above ~1 KB.
- `trust proxy` is set to one hop in production (Render terminates TLS), so
  rate limiting and logs see the real client IP, not the proxy's.

### Rate limits (in-memory, per client IP)

| Bucket           | Scope                    | Limit                | Notes                          |
| ---------------- | ------------------------ | -------------------- | ------------------------------ |
| `apiLimiter`     | all `/api/v1` routes     | 300 / 15 min         | health checks exempt           |
| `loginLimiter`   | `POST /auth/login`       | 10 failures / 15 min | successful logins do not count |
| `registerLimiter`| `POST /auth/register`    | 10 / hour            | every attempt counts           |

Exceeding a bucket returns `429` with `{ message, success: false }` and a
`RateLimit` (draft-8) header. The store is in-memory: a single Render instance
is covered; multiple instances need a shared Redis store.

## Next modules

1. `Account` + append-only double-entry `LedgerTransaction` / `LedgerEntry`
2. Holds derived **available** balance (never a stored number)
3. Cards + authorization → partial capture → reversal state machine
4. Payment requests + maker-checker approvals + threshold
5. Webhook events (unique provider id, idempotent) + reconciliation breaks
6. MCP read tools + one approval-queue write tool
