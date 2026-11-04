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
const TEAM_FLOW = process.env.SMOKE_TEAM_FLOW === "1";
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
    const gatedTenant = await request(`/cards/${foreignCard.id}`, {
      token: newcomer.token,
    });
    check(
      "unverified business cannot reach the card lookup",
      gatedTenant.status === 409,
      `status ${gatedTenant.status}`,
    );
  }

  if (foreignCard) {
    /*
     * `NeoBank Second Co` is a second ACTIVE tenant in the seed. Using it here
     * proves a live 404 rather than the 409 an unverified business would get.
     */
    const otherTenant = await login("second@neobank.dev");
    const crossTenant = await request(`/cards/${foreignCard.id}`, {
      token: otherTenant.token,
    });
    check("foreign tenant card returns 404", crossTenant.status === 404);

    const crossTenantPayment = await request(
      `/payments/smoke-payment-that-does-not-exist`,
      { token: otherTenant.token },
    );
    check(
      "foreign tenant payment id returns 404",
      crossTenantPayment.status === 404,
    );
  }

  section("module 5 · team and payment boundaries (read-only)");
  const ownerTeam = await request("/team", { token: owner.token });
  const teamMembers = ownerTeam.json?.data?.members ?? [];
  check("owner can list the team", ownerTeam.status === 200);
  check(
    "team list contains owner, admin and employee",
    ["OWNER", "ADMIN", "EMPLOYEE"].every((role) =>
      teamMembers.some((member) => member.role === role),
    ),
  );

  const adminTeam = await request("/team", { token: admin.token });
  check("admin can list the team", adminTeam.status === 200);
  const employeeTeam = await request("/team", { token: employee.token });
  check("employee cannot list the team", employeeTeam.status === 403);
  const opsTeam = await request("/team", { token: ops.token });
  check("operations cannot list the team", opsTeam.status === 403);

  const employeeMember = teamMembers.find(
    (member) => member.user.email === "employee@neobank.dev",
  );
  const ownerMember = teamMembers.find((member) => member.isYou);
  check("team member row is present for the employee", Boolean(employeeMember));

  if (employeeMember) {
    const secondTenant = await login("second@neobank.dev");
    const secondTeam = await request("/team", { token: secondTenant.token });
    check("another tenant sees only its own team", secondTeam.status === 200);
    check(
      "another tenant's team contains no demo member",
      (secondTeam.json?.data?.members ?? []).every(
        (member) => member.businessId === secondTenant.user.business?.id,
      ),
    );

    const foreignMemberPatch = await request(
      `/team/members/${employeeMember.id}`,
      {
        method: "PATCH",
        token: secondTenant.token,
        body: { role: "EMPLOYEE" },
      },
    );
    check(
      "another tenant cannot change a real member",
      foreignMemberPatch.status === 404,
    );

    const adminChangesRole = await request(
      `/team/members/${employeeMember.id}`,
      {
        method: "PATCH",
        token: admin.token,
        body: { role: "ADMIN" },
      },
    );
    check("admin cannot change a role", adminChangesRole.status === 403);

    const adminDisables = await request(`/team/members/${employeeMember.id}`, {
      method: "DELETE",
      token: admin.token,
    });
    check("admin cannot disable a member", adminDisables.status === 403);
  }

  if (ownerMember) {
    const ownerChangesOwnRole = await request(
      `/team/members/${ownerMember.id}`,
      {
        method: "PATCH",
        token: owner.token,
        body: { role: "EMPLOYEE" },
      },
    );
    check("owner cannot change their own role", ownerChangesOwnRole.status === 403);

    const ownerDisablesSelf = await request(`/team/members/${ownerMember.id}`, {
      method: "DELETE",
      token: owner.token,
    });
    check("owner cannot disable their own membership", ownerDisablesSelf.status === 403);
  }

  const foreignMember = await request("/team/members/smoke-missing-member", {
    method: "PATCH",
    token: owner.token,
    body: { role: "EMPLOYEE" },
  });
  check("foreign member id returns 404", foreignMember.status === 404);

  const adminPolicyPatch = await request(
    "/businesses/current/approval-policy",
    {
      method: "PATCH",
      token: admin.token,
      body: { approvalThresholdMinor: "10000" },
    },
  );
  check("admin cannot change the approval threshold", adminPolicyPatch.status === 403);

  const ownerPolicy = await request("/businesses/current/approval-policy", {
    token: owner.token,
  });
  check("owner can read the approval policy", ownerPolicy.status === 200);
  check(
    "policy exposes an integer-string threshold",
    typeof ownerPolicy.json?.data?.policy?.approvalThresholdMinor === "string",
  );

  const employeePayments = await request("/payments", { token: employee.token });
  const employeeRequests = employeePayments.json?.data?.requests ?? [];
  check("employee can list own payment requests", employeePayments.status === 200);
  check(
    "employee payment list contains only their own rows",
    employeeRequests.every(
      (row) => row.createdByUserId === employee.user.id,
    ),
  );

  const employeeQueue = await request("/approvals", { token: employee.token });
  check("employee cannot read the approval queue", employeeQueue.status === 403);
  const opsQueue = await request("/approvals", { token: ops.token });
  check("operations cannot read the approval queue", opsQueue.status === 403);

  const opsPayment = await request("/payments", {
    method: "POST",
    token: ops.token,
    body: { beneficiaryName: "Ops Vendor", amountMinor: "100" },
  });
  check("operations cannot create a payment", opsPayment.status === 403);

  const foreignPayment = await request("/payments/smoke-missing-payment", {
    token: owner.token,
  });
  check("foreign payment id returns 404", foreignPayment.status === 404);

  if (TEAM_FLOW) {
    section("module 5 · invitations, maker-checker and threshold (mutates)");

    const before = balanceOf(
      await request("/accounts/current", { token: owner.token }),
    );

    /* --- Invitation: create, rotate, register, change role, disable. --- */
    const inviteEmail = `smoke+invite+${RUN_ID}@neobank.test`;
    const firstInvite = await request("/team/invitations", {
      method: "POST",
      token: owner.token,
      body: { email: inviteEmail, role: "EMPLOYEE" },
    });
    check("owner creates an invitation", firstInvite.status === 201);
    check(
      "invitation returns a raw token and link exactly on create",
      typeof firstInvite.json?.data?.token === "string" &&
        typeof firstInvite.json?.data?.link === "string",
    );
    const firstToken = firstInvite.json?.data?.token;

    const secondInvite = await request("/team/invitations", {
      method: "POST",
      token: owner.token,
      body: { email: inviteEmail, role: "EMPLOYEE" },
    });
    const secondToken = secondInvite.json?.data?.token;
    check(
      "a second invitation rotates the live token",
      secondInvite.status === 201 && secondToken !== firstToken,
    );
    const oldToken = await request(
      `/team/invitations/${encodeURIComponent(firstToken)}`,
    );
    check("the replaced token returns 404", oldToken.status === 404);

    const preview = await request(
      `/team/invitations/${encodeURIComponent(secondToken)}`,
    );
    check("the live token resolves publicly", preview.status === 200);
    check(
      "the preview names the invited business",
      preview.json?.data?.invitation?.business?.id ===
        owner.user.business?.id &&
        typeof preview.json?.data?.invitation?.business?.legalName === "string",
    );

    const wrongEmailAccept = await request(
      `/team/invitations/${encodeURIComponent(secondToken)}/accept`,
      { method: "POST", token: employee.token, body: {} },
    );
    check("accepting with a different email returns 403", wrongEmailAccept.status === 403);

    const register = await request(
      `/team/invitations/${encodeURIComponent(secondToken)}/register`,
      {
        method: "POST",
        body: {
          username: `smokeinvite_${RUN_ID}`,
          password: PASSWORD,
        },
      },
    );
    check("token-gated register creates the invited user", register.status === 201);
    check(
      "token-gated register creates an EMPLOYEE, not an OWNER",
      register.json?.data?.user?.role === "EMPLOYEE",
    );
    check(
      "token-gated register joins the existing business",
      register.json?.data?.business?.id === owner.user.business?.id,
    );
    const invitedToken = register.json?.data?.token;
    const invitedId = register.json?.data?.user?.id;

    const usedToken = await request(
      `/team/invitations/${encodeURIComponent(secondToken)}`,
    );
    check("an accepted token returns 404", usedToken.status === 404);

    const invitedTeam = await request("/team", { token: invitedToken });
    check("an invited employee cannot list the team", invitedTeam.status === 403);

    const invitedMember = (await request("/team", { token: owner.token })).json
      ?.data?.members?.find((member) => member.userId === invitedId);
    check("the invited member appears on the team", Boolean(invitedMember));

    if (invitedMember) {
      const promote = await request(`/team/members/${invitedMember.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { role: "ADMIN" },
      });
      check("owner promotes the invited employee to admin", promote.status === 200);
      check("the promotion returns the new role", promote.json?.data?.member?.role === "ADMIN");

      const staleToken = await request("/auth/me", { token: invitedToken });
      check("a role change invalidates the old JWT", staleToken.status === 401);

      const relogin = await login(inviteEmail);
      check("a fresh login sees the new admin role", relogin.user.role === "ADMIN");

      const disable = await request(`/team/members/${invitedMember.id}`, {
        method: "DELETE",
        token: owner.token,
      });
      check("owner disables the member", disable.status === 200);
      check("the disabled membership is marked DISABLED", disable.json?.data?.member?.status === "DISABLED");

      const disabledSession = await request("/auth/me", {
        token: relogin.token,
      });
      check("a disabled member's JWT stops working", disabledSession.status === 401);

      const reinvite = await request("/team/invitations", {
        method: "POST",
        token: owner.token,
        body: { email: inviteEmail, role: "EMPLOYEE" },
      });
      check("a disabled member cannot be re-invited into a dead link", reinvite.status === 409);
    }

    const crossBusinessInvite = await request("/team/invitations", {
      method: "POST",
      token: owner.token,
      body: { email: "pending@neobank.dev", role: "EMPLOYEE" },
    });
    check(
      "inviting another business's member is refused",
      crossBusinessInvite.status === 409,
    );

    /* --- Maker-checker: employee request, admin approval. --- */
    const paymentBody = {
      beneficiaryName: "Smoke Supplies",
      beneficiaryReference: `INV-${RUN_ID}`,
      amountMinor: "500000",
      memo: "Smoke maker-checker",
    };
    const created = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-payment-${RUN_ID}`,
      body: paymentBody,
    });
    check("employee creates a payment request", created.status === 201);
    check(
      "an amount at the threshold is PENDING_APPROVAL",
      created.json?.data?.request?.status === "PENDING_APPROVAL",
    );
    const paymentId = created.json?.data?.request?.id;

    const secondTenant = await login("second@neobank.dev");
    const foreignRealPayment = await request(`/payments/${paymentId}`, {
      token: secondTenant.token,
    });
    check(
      "another tenant cannot read a real payment id",
      foreignRealPayment.status === 404,
    );
    const foreignApprove = await request(`/payments/${paymentId}/approve`, {
      method: "POST",
      token: secondTenant.token,
      body: {},
    });
    check(
      "another tenant cannot approve a foreign payment",
      foreignApprove.status === 404,
    );

    const afterCreate = balanceOf(
      await request("/accounts/current", { token: owner.token }),
    );
    check(
      "creating a pending request does not move the ledger",
      minor(afterCreate.ledgerMinor) === minor(before.ledgerMinor),
    );

    const replay = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-payment-${RUN_ID}`,
      body: paymentBody,
    });
    check("a repeated idempotency key returns the original", replay.json?.data?.request?.id === paymentId);
    check("the replay is labelled", replay.json?.data?.replayed === true);

    const selfApproveEmployee = await request(
      `/payments/${paymentId}/approve`,
      { method: "POST", token: employee.token, body: {} },
    );
    check(
      "an employee cannot approve",
      selfApproveEmployee.status === 403,
    );

    const approved = await request(`/payments/${paymentId}/approve`, {
      method: "POST",
      token: admin.token,
      body: {},
    });
    check("an admin approves a different person's request", approved.status === 200);
    check("the request becomes COMPLETED", approved.json?.data?.request?.status === "COMPLETED");
    check(
      "the completed request names the approver",
      approved.json?.data?.request?.decisionByUserId === admin.user.id,
    );
    check(
      "a balanced PAYMENT transaction is linked",
      approved.json?.data?.request?.ledgerTransaction?.kind === "PAYMENT" &&
        approved.json?.data?.request?.ledgerTransaction?.lines?.length === 2,
    );

    const afterApproval = balanceOf(
      await request("/accounts/current", { token: owner.token }),
    );
    check(
      "approval decreases available balance by exactly the amount",
      minor(before.availableMinor) - minor(afterApproval.availableMinor) ===
        500000n,
      `${before.availableMinor} -> ${afterApproval.availableMinor}`,
    );

    const doubleApprove = await request(`/payments/${paymentId}/approve`, {
      method: "POST",
      token: owner.token,
      body: {},
    });
    check("a second approval returns 409", doubleApprove.status === 409);
    const afterDouble = balanceOf(
      await request("/accounts/current", { token: owner.token }),
    );
    check(
      "a second approval posts nothing",
      minor(afterDouble.ledgerMinor) === minor(afterApproval.ledgerMinor),
    );

    /* --- Self-approval by an approver, then rejection. --- */
    const adminRequest = await request("/payments", {
      method: "POST",
      token: admin.token,
      idempotencyKey: `smoke-admin-payment-${RUN_ID}`,
      body: {
        beneficiaryName: "Admin Self Vendor",
        amountMinor: "1000",
      },
    });
    const adminPaymentId = adminRequest.json?.data?.request?.id;
    const adminSelfApprove = await request(
      `/payments/${adminPaymentId}/approve`,
      { method: "POST", token: admin.token, body: {} },
    );
    check(
      "an owner/admin cannot approve their own request",
      adminSelfApprove.status === 403,
    );

    const emptyReject = await request(`/payments/${adminPaymentId}/reject`, {
      method: "POST",
      token: owner.token,
      body: {},
    });
    check("rejection without a reason is refused", emptyReject.status === 400);

    const rejected = await request(`/payments/${adminPaymentId}/reject`, {
      method: "POST",
      token: owner.token,
      body: { reason: "Out of policy this quarter" },
    });
    check("a different approver rejects with a reason", rejected.status === 200);
    check("the request becomes REJECTED", rejected.json?.data?.request?.status === "REJECTED");
    check(
      "rejection posts no ledger transaction",
      rejected.json?.data?.request?.ledgerTransactionId === null,
    );

    const rejectedApprove = await request(
      `/payments/${adminPaymentId}/approve`,
      { method: "POST", token: owner.token, body: {} },
    );
    check("a rejected request cannot be approved later", rejectedApprove.status === 409);

    /* --- Cancel and insufficient funds. --- */
    const cancelRequest = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-cancel-${RUN_ID}`,
      body: { beneficiaryName: "Cancel Vendor", amountMinor: "2500" },
    });
    const cancelId = cancelRequest.json?.data?.request?.id;
    const canceled = await request(`/payments/${cancelId}/cancel`, {
      method: "POST",
      token: employee.token,
      body: {},
    });
    check("the creator cancels a pending request", canceled.status === 200);
    check("the request becomes CANCELED", canceled.json?.data?.request?.status === "CANCELED");

    const available = minor(
      balanceOf(await request("/accounts/current", { token: owner.token }))
        .availableMinor,
    );
    const hugeRequest = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-huge-${RUN_ID}`,
      body: {
        beneficiaryName: "Too Large Vendor",
        amountMinor: (available + 100000n).toString(),
      },
    });
    const hugeId = hugeRequest.json?.data?.request?.id;
    const hugeApprove = await request(`/payments/${hugeId}/approve`, {
      method: "POST",
      token: admin.token,
      body: {},
    });
    check("approval with insufficient funds returns 409", hugeApprove.status === 409);
    const hugeDetail = await request(`/payments/${hugeId}`, {
      token: owner.token,
    });
    check(
      "the insufficient-funds request stays pending",
      hugeDetail.json?.data?.request?.status === "PENDING_APPROVAL",
    );
    await request(`/payments/${hugeId}/cancel`, {
      method: "POST",
      token: employee.token,
      body: {},
    });

    /* --- Employee isolation on a foreign payment row. --- */
    const employeeReadsAdmin = await request(`/payments/${adminPaymentId}`, {
      token: employee.token,
    });
    check(
      "an employee cannot read another person's payment",
      employeeReadsAdmin.status === 404,
    );

    /* --- Threshold: below auto-approves, at the line waits. --- */
    const setThreshold = await request("/businesses/current/approval-policy", {
      method: "PATCH",
      token: owner.token,
      body: { approvalThresholdMinor: "10000" },
    });
    check("owner sets a $100 threshold", setThreshold.status === 200);

    const below = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-below-${RUN_ID}`,
      body: { beneficiaryName: "Small Vendor", amountMinor: "5000" },
    });
    check("below-threshold auto-approval completes", below.json?.data?.request?.status === "COMPLETED");
    check(
      "auto-approval records no human approver",
      below.json?.data?.request?.decisionByUserId === null,
    );

    const atThreshold = await request("/payments", {
      method: "POST",
      token: employee.token,
      idempotencyKey: `smoke-at-${RUN_ID}`,
      body: { beneficiaryName: "At Threshold Vendor", amountMinor: "10000" },
    });
    const atThresholdId = atThreshold.json?.data?.request?.id;
    check(
      "an amount exactly at the threshold waits",
      atThreshold.json?.data?.request?.status === "PENDING_APPROVAL",
    );
    await request(`/payments/${atThresholdId}/cancel`, {
      method: "POST",
      token: employee.token,
      body: {},
    });

    const restore = await request("/businesses/current/approval-policy", {
      method: "PATCH",
      token: owner.token,
      body: { approvalThresholdMinor: "0" },
    });
    check("owner restores the zero threshold", restore.status === 200);

    /* --- Validation refusals. --- */
    for (const amountMinor of ["0", "-1", "1.5", "999999999999999999"]) {
      const invalid = await request("/payments", {
        method: "POST",
        token: employee.token,
        idempotencyKey: `smoke-invalid-${amountMinor}-${RUN_ID}`,
        body: { beneficiaryName: "Invalid", amountMinor },
      });
      check(
        `amount ${amountMinor} is refused`,
        invalid.status === 400 || invalid.status === 422,
      );
    }

    const integrityAfterTeam = await request("/operations/ledger/integrity", {
      token: ops.token,
    });
    check(
      "integrity clean after team and payment flow",
      integrityAfterTeam.json?.data?.ok === true,
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
