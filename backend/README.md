# NeoBank — Backend

Express + TypeScript API for the Corgi Neobank work trial (Track 3). This is the
**auth foundation** of a larger build: register, login, profile and logout on top
of PostgreSQL + Prisma. Business, ledger, card, payment and reconciliation
modules are added next.

## Stack

| Concern    | Choice                                        |
| ---------- | --------------------------------------------- |
| Runtime    | Node.js 22+ (ESM, native `.ts` via `tsx`)     |
| HTTP       | Express 4 + `inversify-express-utils`         |
| Database   | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)  |
| Auth       | JWT (Bearer) + httpOnly cookie, bcrypt hashes |
| Validation | Joi at the boundary                           |

## Roles

Business roles live on `User.role` until the `BusinessMember` model lands:

| Role         | Meaning                                                               |
| ------------ | --------------------------------------------------------------------- |
| `OWNER`      | Registered the business; owns account, team, cards and approvals      |
| `ADMIN`      | Manages team/cards and can approve payments                           |
| `EMPLOYEE`   | Uses an assigned card, initiates payment requests                     |
| `OPERATIONS` | Platform operator: reads webhooks/ledger/breaks; never moves money    |

Public registration always creates an `OWNER`. A client can never self-assign a
role; team members are assigned by an `OWNER`/`ADMIN`. The initiator/approver
split is a permission check, not a separate role: an approver can never approve
their own request.

## Quick start

```bash
cp .env.example .env      # fill DATABASE_URL + a long JWT_SECRET
npm install
npm run db:push           # sync the schema (use db:migrate for real migrations)
npm run db:seed           # optional: demo users
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
| POST   | `/auth/register`  | —    | `{ username, email, password }` → creates OWNER |
| POST   | `/auth/login`     | —    | `{ email, password }` → `{ user, token }`       |
| GET    | `/auth/profile`   | Yes  | current user                                    |
| POST   | `/auth/logout`    | Yes  | blacklists the presented JWT and clears cookie  |

Auth accepts either `Authorization: Bearer <token>` or the `token` httpOnly
cookie set by register/login. Logout requires a valid token.

### Example

```bash
curl -s http://localhost:5000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@neobank.dev","password":"NeoBank@123"}'

curl -s http://localhost:5000/api/v1/auth/profile \
  -H "authorization: Bearer <token>"
```

Status codes: `201` register, `200` read/OK, `400` validation, `401` missing or
invalid/blacklisted token, `403` deleted account, `409` duplicate email/username.

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
├── config/        env, DI container, Prisma lifecycle
├── constants/     status codes, roles, error copy
├── controllers/   HTTP surface (auth only for now)
├── middlewares/   auth, request context
├── repositories/  persistence (no business rules)
├── services/      business rules
├── types/         DTOs + DB contracts
├── utils/         JWT, logger, ApiError, request context
└── validators/    Joi schemas
prisma/
├── schema.prisma  User + BlacklistToken
└── seed.ts        demo users
```

## Security notes

- Passwords are hashed with bcrypt (10 rounds) and never returned by queries.
- `password` is omitted client-wide; only the login read opts back in.
- Tokens carry `tokenVersion`, so soft delete / logout-all invalidates old JWTs.
- Logout blacklists the exact token until its `exp`.
- Cookie is `httpOnly`; `secure` + `SameSite=None` in production because the
  frontend is on a different origin than the API.
- `CORS_ORIGIN` is an allow-list; never commit a real `JWT_SECRET`.

## Next modules

1. `Business` + `BusinessMember` (move roles to membership, invite flow)
2. `Account` + append-only double-entry `LedgerTransaction` / `LedgerEntry`
3. Holds derived **available** balance (never a stored number)
4. Cards + authorization → partial capture → reversal state machine
5. Payment requests + maker-checker approvals + threshold
6. Webhook events (unique provider id, idempotent) + reconciliation breaks
7. MCP read tools + one approval-queue write tool
