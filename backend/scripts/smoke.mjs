#!/usr/bin/env node
/**
 * Live-fire smoke test against a running API.
 *
 * It proves the boundaries that matter in review, not just the happy path:
 *
 *   - every role can sign in, and the wrong password cannot
 *   - employees are refused the business balance, card issuing and the queue
 *   - manual reversal and integrity are operations-only
 *   - a foreign tenant id returns 404, not 403
 *   - an unverified business is gated with 409
 *   - optional: authorize / clear idempotency on a real Sandbox card
 *
 * Usage:
 *   npm run smoke
 *   SMOKE_CARD_FLOW=1 npm run smoke      # mutates the demo ledger by $1.00
 *   API_URL=https://api.example.com/api/v1 npm run smoke
 *
 * Requires the seeded demo accounts (`npm run db:seed`). It never prints a
 * token, a password from the environment, or provider credentials.
 */

const BASE = (process.env.API_URL ?? "http://localhost:5000/api/v1").replace(
  /\/$/,
  "",
);
const PASSWORD = process.env.SMOKE_PASSWORD ?? "NeoBank@123";
const CARD_FLOW = process.env.SMOKE_CARD_FLOW === "1";
const RUN_ID = Date.now().toString(36);

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return true;
  }

  failures.push(name);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

function section(title) {
  console.log(`\n${title}`);
}

async function request(path, options = {}) {
  const headers = {
    Accept: "application/json",
    "x-request-id": `smoke-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
  };

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 200) };
  }

  return { status: response.status, json };
}

async function login(email) {
  const response = await request("/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD },
  });

  if (response.status !== 200) {
    throw new Error(
      `login failed for ${email}: ${response.status} ${
        response.json?.message ?? ""
      }`,
    );
  }

  return {
    token: response.json.data.token,
    user: response.json.data.user,
    onboarding: response.json.data.onboarding,
  };
}

function minor(value) {
  return BigInt(value ?? "0");
}

function balanceOf(response) {
  return response.json?.data?.account?.balance ?? {};
}

async function main() {
  console.log(`NeoBank smoke test → ${BASE}`);

  section("health");
  const health = await request("/health");
  check("GET /health returns 200", health.status === 200);
  check("health payload is ok", health.json?.status === "ok");

  section("authentication and roles");
  const owner = await login("owner@neobank.dev");
  const admin = await login("admin@neobank.dev");
  const employee = await login("employee@neobank.dev");
  const ops = await login("ops@neobank.dev");

  check("owner role", owner.user.role === "OWNER", owner.user.role);
  check("admin role", admin.user.role === "ADMIN", admin.user.role);
  check("employee role", employee.user.role === "EMPLOYEE", employee.user.role);
  check("operations role", ops.user.role === "OPERATIONS", ops.user.role);

  const wrongPassword = await request("/auth/login", {
    method: "POST",
    body: { email: "owner@neobank.dev", password: "definitely-wrong" },
  });
  check("wrong password is refused", wrongPassword.status === 401);

  section("role gates");
  const employeeBalance = await request("/accounts/current", {
    token: employee.token,
  });
  check("employee cannot read the balance", employeeBalance.status === 403);

  const employeeIssue = await request("/cards", {
    method: "POST",
    token: employee.token,
    body: { userId: employee.user.id },
  });
  check("employee cannot issue a card", employeeIssue.status === 403);

  const ownerBalance = await request("/accounts/current", {
    token: owner.token,
  });
  const balance = balanceOf(ownerBalance);
  check("owner can read the balance", ownerBalance.status === 200);
  check(
    "balance exposes ledger/hold/available in minor units",
    typeof balance.ledgerMinor === "string" &&
      typeof balance.holdMinor === "string" &&
      typeof balance.availableMinor === "string",
  );

  const ownerIntegrity = await request("/operations/ledger/integrity", {
    token: owner.token,
  });
  check("owner cannot read ledger integrity", ownerIntegrity.status === 403);

  const opsIntegrity = await request("/operations/ledger/integrity", {
    token: ops.token,
  });
  check("operations can read ledger integrity", opsIntegrity.status === 200);
  check("ledger integrity is clean", opsIntegrity.json?.data?.ok === true);

  const ownerReverse = await request(
    "/operations/ledger/transactions/smoke-missing/reverse",
    {
      method: "POST",
      token: owner.token,
      idempotencyKey: `smoke-owner-reverse-${RUN_ID}`,
    },
  );
  check("owner cannot reverse a transaction", ownerReverse.status === 403);

  const opsReverse = await request(
    "/operations/ledger/transactions/smoke-missing/reverse",
    {
      method: "POST",
      token: ops.token,
      idempotencyKey: `smoke-ops-reverse-${RUN_ID}`,
    },
  );
  check("operations gets 404 for a missing transaction", opsReverse.status === 404);

  section("card isolation");
  const ownerCards = await request("/cards", { token: owner.token });
  const cards = ownerCards.json?.data?.cards ?? [];
  check("owner can list cards", ownerCards.status === 200);

  const employeeCards = await request("/cards", { token: employee.token });
  const employeeCardRows = employeeCards.json?.data?.cards ?? [];
  check("employee can list own cards", employeeCards.status === 200);
  check(
    "employee list contains only their own cards",
    employeeCardRows.every((card) => card.employee?.id === employee.user.id),
  );

  const unknownCard = await request("/cards/smoke-card-that-does-not-exist", {
    token: owner.token,
  });
  check("unknown card id returns 404", unknownCard.status === 404);

  const foreignCard = cards[0];
  if (foreignCard) {
    const employeeReadsForeign = await request(`/cards/${foreignCard.id}`, {
      token: employee.token,
    });
    const ownsIt = foreignCard.employee?.id === employee.user.id;
    check(
      ownsIt
        ? "employee can read their own card"
        : "employee cannot read another employee's card",
      ownsIt
        ? employeeReadsForeign.status === 200
        : employeeReadsForeign.status === 404,
      `status ${employeeReadsForeign.status}`,
    );
  }

  section("tenancy and onboarding");
  const email = `smoke+${RUN_ID}@neobank.test`;
  const registration = await request("/auth/register", {
    method: "POST",
    body: {
      username: `smoke_${RUN_ID}`,
      email,
      password: PASSWORD,
      businessName: `Smoke Test Co ${RUN_ID}`,
    },
  });

  check("public registration succeeds", registration.status === 201);
  check("public registration creates an OWNER", registration.json?.data?.user?.role === "OWNER");
  check(
    "a new business starts unverified",
    registration.json?.data?.user?.business?.status === "PENDING_VERIFICATION",
    registration.json?.data?.user?.business?.status,
  );

  const newcomer = await login(email);
  const pendingBalance = await request("/accounts/current", {
    token: newcomer.token,
  });
  check("unverified business cannot read the balance", pendingBalance.status === 409);

  const pendingDeposit = await request("/accounts/current/deposits", {
    method: "POST",
    token: newcomer.token,
    idempotencyKey: `smoke-pending-deposit-${RUN_ID}`,
    body: { amountMinor: "100" },
  });
  check("unverified business cannot deposit", pendingDeposit.status === 409);

  if (foreignCard) {
    /*
     * Use the second seeded tenant (`NeoBank Pending Co`, despite the name it
     * is ACTIVE) so the card lookup actually runs. A brand-new unverified
     * business is gated earlier with 409, which is a different assertion.
     */
    const otherTenant = await login("pending@neobank.dev");
    const crossTenant = await request(`/cards/${foreignCard.id}`, {
      token: otherTenant.token,
    });
    check("foreign tenant card returns 404", crossTenant.status === 404);
  }

  if (foreignCard) {
    const gatedTenant = await request(`/cards/${foreignCard.id}`, {
      token: newcomer.token,
    });
    check(
      "unverified business cannot reach the card lookup",
      gatedTenant.status === 409,
      `status ${gatedTenant.status}`,
    );
  }

  section("ledger integrity after reads");
  const finalIntegrity = await request("/operations/ledger/integrity", {
    token: ops.token,
  });
  check("integrity still clean", finalIntegrity.json?.data?.ok === true);

  if (CARD_FLOW) {
    section("card authorize / clear idempotency (mutates $1.00)");
    const card = cards.find((row) => row.status === "ACTIVE");

    if (!card) {
      console.log("  SKIP  no ACTIVE card in the demo business");
    } else {
      const before = balanceOf(
        await request("/accounts/current", { token: owner.token }),
      );

      const authorize = await request(`/cards/${card.id}/simulate/authorize`, {
        method: "POST",
        token: owner.token,
        body: {
          amountMinor: "100",
          descriptor: "SMOKE TEST",
          eventId: `smoke_auth_${RUN_ID}`,
        },
      });
      check("authorization is processed", authorize.status === 201);
      const transactionToken = authorize.json?.data?.transactionToken;
      check("authorization returns a transaction token", Boolean(transactionToken));

      const afterAuth = balanceOf(
        await request("/accounts/current", { token: owner.token }),
      );
      check(
        "authorization holds exactly the amount",
        minor(afterAuth.holdMinor) - minor(before.holdMinor) === 100n,
        `${before.holdMinor} -> ${afterAuth.holdMinor}`,
      );
      check(
        "authorization does not post to the ledger",
        minor(afterAuth.ledgerMinor) === minor(before.ledgerMinor),
      );

      const replay = await request(`/cards/${card.id}/simulate/authorize`, {
        method: "POST",
        token: owner.token,
        body: {
          amountMinor: "100",
          descriptor: "SMOKE TEST",
          eventId: `smoke_auth_${RUN_ID}`,
        },
      });
      const afterReplay = balanceOf(
        await request("/accounts/current", { token: owner.token }),
      );
      check(
        "replayed authorization does not hold twice",
        minor(afterReplay.holdMinor) === minor(afterAuth.holdMinor),
      );
      check(
        "replayed authorization is reported as a duplicate",
        ["duplicate", "ignored"].includes(replay.json?.data?.outcome),
        replay.json?.data?.outcome,
      );

      const clearing = await request(`/cards/${card.id}/simulate/clear`, {
        method: "POST",
        token: owner.token,
        body: {
          transactionToken,
          amountMinor: "100",
          eventId: `smoke_clear_${RUN_ID}`,
        },
      });
      check("clearing is processed", clearing.status === 201);

      const afterClear = balanceOf(
        await request("/accounts/current", { token: owner.token }),
      );
      check(
        "clearing posts exactly the settled amount",
        minor(before.ledgerMinor) - minor(afterClear.ledgerMinor) === 100n,
        `${before.ledgerMinor} -> ${afterClear.ledgerMinor}`,
      );
      check(
        "clearing releases the hold",
        minor(afterClear.holdMinor) === minor(before.holdMinor),
        `${afterClear.holdMinor}`,
      );

      const clearReplay = await request(`/cards/${card.id}/simulate/clear`, {
        method: "POST",
        token: owner.token,
        body: {
          transactionToken,
          amountMinor: "100",
          eventId: `smoke_clear_${RUN_ID}`,
        },
      });
      const afterClearReplay = balanceOf(
        await request("/accounts/current", { token: owner.token }),
      );
      check(
        "replayed clearing does not post twice",
        minor(afterClearReplay.ledgerMinor) === minor(afterClear.ledgerMinor),
      );
      check(
        "replayed clearing is reported as a duplicate",
        ["duplicate", "ignored"].includes(clearReplay.json?.data?.outcome),
        clearReplay.json?.data?.outcome,
      );

      const integrityAfterCard = await request("/operations/ledger/integrity", {
        token: ops.token,
      });
      check("integrity clean after card flow", integrityAfterCard.json?.data?.ok === true);
    }
  }

  console.log(
    `\n${passed} passed, ${failures.length} failed${
      CARD_FLOW ? "" : " (card flow skipped; set SMOKE_CARD_FLOW=1)"
    }`,
  );

  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nSmoke test aborted: ${error.message}`);
  process.exitCode = 1;
});
