/**
 * Demo seed.
 *
 * Idempotent: running it twice leaves the same businesses and users, with
 * passwords reset to the documented demo value. Never point this at a database
 * that holds anything you care about.
 *
 * Two states are seeded on purpose:
 *
 * - `NeoBank Demo Co` is fully onboarded and `ACTIVE`, with a synthetic
 *   APPROVED sandbox attempt, so the post-onboarding dashboard can be opened.
 * - `NeoBank Pending Co` is freshly registered and incomplete, so the
 *   profile → verification journey can be walked from the beginning.
 *
 * Usage: npm run db:seed
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import {
  BUSINESS_STATUS,
  BUSINESS_TYPE,
  MEMBERSHIP_STATUS,
  PAYMENT_REQUEST_STATUS,
  USER_ROLE,
  VERIFICATION_ENVIRONMENT,
  VERIFICATION_PROVIDER,
  VERIFICATION_STATUS,
  type BusinessStatus,
  type UserRole,
} from "../src/constants/constants.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEMO_PASSWORD = "NeoBank@123";

interface DemoUser {
  username: string;
  email: string;
  role: UserRole;
}

interface DemoBusiness {
  legalName: string;
  status: BusinessStatus;
  complete: boolean;
  /**
   * Seed a verification row, ledger and payment queue. The primary demo tenant
   * gets all three; the second active tenant exists to prove tenant isolation
   * and needs a ledger but not a shared payment queue.
   */
  seedFinance?: boolean;
  /** Verification session id, unique per seeded business. */
  verificationSessionId?: string;
  /** Profile override for a tenant that is not the primary demo. */
  profile?: Record<string, string | null>;
  users: DemoUser[];
}

const demoBusinesses: DemoBusiness[] = [
  {
    legalName: "NeoBank Demo Co",
    status: BUSINESS_STATUS.ACTIVE,
    complete: true,
    verificationSessionId: "seed-demo-kyb-session",
    users: [
      { username: "owner", email: "owner@neobank.dev", role: USER_ROLE.OWNER },
      { username: "admin", email: "admin@neobank.dev", role: USER_ROLE.ADMIN },
      {
        username: "employee",
        email: "employee@neobank.dev",
        role: USER_ROLE.EMPLOYEE,
      },
      {
        username: "ops",
        email: "ops@neobank.dev",
        role: USER_ROLE.OPERATIONS,
      },
    ],
  },
  {
    /*
     * A second ACTIVE tenant. It has its own owner, ledger and verification, so
     * cross-tenant reads can be proven with a live 404 instead of an
     * inactive-business 409. It deliberately has no demo payment queue.
     */
    legalName: "NeoBank Second Co",
    status: BUSINESS_STATUS.ACTIVE,
    complete: true,
    seedFinance: false,
    verificationSessionId: "seed-second-kyb-session",
    profile: {
      tradingName: "Second Co",
      businessType: BUSINESS_TYPE.CORPORATION,
      registrationNumber: "SEED-CORP-0002",
      industry: "Logistics",
      description: "Second seeded tenant used for isolation checks.",
      email: "second@neobank.dev",
      phone: "+14155550124",
      website: "https://second.neobank.dev",
      addressLine1: "500 Mission Street",
      addressLine2: "Floor 2",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "US",
    },
    users: [
      {
        username: "second",
        email: "second@neobank.dev",
        role: USER_ROLE.OWNER,
      },
    ],
  },
  {
    legalName: "NeoBank Pending Co",
    status: BUSINESS_STATUS.PENDING_VERIFICATION,
    complete: false,
    users: [
      {
        username: "pending",
        email: "pending@neobank.dev",
        role: USER_ROLE.OWNER,
      },
    ],
  },
];

/** Profile values for the completed demo business (all fictional). */
const COMPLETE_PROFILE = {
  tradingName: "Demo Co",
  businessType: BUSINESS_TYPE.LLC,
  registrationNumber: "SEED-LLC-0001",
  industry: "Software",
  description: "Seeded business for the Module 1 onboarding walkthrough.",
  email: "ops@neobank.dev",
  phone: "+14155550123",
  website: "https://neobank.dev",
  addressLine1: "123 Market Street",
  addressLine2: "Suite 400",
  city: "San Francisco",
  state: "CA",
  postalCode: "94105",
  country: "US",
} as const;

async function seedBusiness(demo: DemoBusiness): Promise<string> {
  const existing = await prisma.business.findFirst({
    where: { legalName: demo.legalName },
  });

  const profile = demo.complete
    ? (demo.profile ?? COMPLETE_PROFILE)
    : {
        businessType: null,
        registrationNumber: null,
        industry: null,
        description: null,
        email: null,
        phone: null,
        website: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
      };

  const business = existing
    ? await prisma.business.update({
        where: { id: existing.id },
        data: {
          ...profile,
          country: "US",
          currency: "USD",
          status: demo.status,
          /* Module 5 default: every positive payment needs a second person. */
          ...(demo.complete
            ? {
                approvalThresholdMinor: BigInt(0),
                requireSeparateApprover: true,
              }
            : {}),
        },
      })
    : await prisma.business.create({
        data: {
          ...profile,
          legalName: demo.legalName,
          country: "US",
          currency: "USD",
          status: demo.status,
          ...(demo.complete
            ? {
                approvalThresholdMinor: BigInt(0),
                requireSeparateApprover: true,
              }
            : {}),
        },
      });

  return business.id;
}

async function seedVerification(
  businessId: string,
  sessionId: string,
): Promise<void> {
  /*
   * A synthetic approval for the demo business. `environment = SANDBOX` and a
   * scenario slug make it obvious in the API and the UI that this is not a
   * real KYB decision.
   */
  await prisma.verification.upsert({
    where: { providerSessionId: sessionId },
    create: {
      businessId,
      provider: VERIFICATION_PROVIDER.DIDIT,
      providerSessionId: sessionId,
      workflowId: "seed-workflow",
      environment: VERIFICATION_ENVIRONMENT.SANDBOX,
      sandboxScenario: "approve",
      status: VERIFICATION_STATUS.APPROVED,
      providerStatus: "Approved",
      reviewResult: {
        status: "Approved",
        rejectLabels: [],
        warnings: [],
      },
      attemptNumber: 1,
      submittedAt: new Date(),
      reviewedAt: new Date(),
      lastSyncedAt: new Date(),
    },
    update: {
      businessId,
      status: VERIFICATION_STATUS.APPROVED,
      providerStatus: "Approved",
      environment: VERIFICATION_ENVIRONMENT.SANDBOX,
      sandboxScenario: "approve",
      reviewedAt: new Date(),
    },
  });
}

async function seedLedger(businessId: string): Promise<void> {
  const account = await prisma.account.upsert({
    where: { businessId_currency: { businessId, currency: "USD" } },
    create: { businessId, currency: "USD", environment: "SANDBOX" },
    update: {},
  });
  const funds = await prisma.ledgerAccount.upsert({
    where: { accountId_code: { accountId: account.id, code: "1010" } },
    create: {
      businessId,
      accountId: account.id,
      code: "1010",
      name: "CUSTOMER_FUNDS",
      type: "ASSET",
      currency: "USD",
    },
    update: {},
  });
  const wallet = await prisma.ledgerAccount.upsert({
    where: { accountId_code: { accountId: account.id, code: "2010" } },
    create: {
      businessId,
      accountId: account.id,
      code: "2010",
      name: "WALLET",
      type: "LIABILITY",
      currency: "USD",
    },
    update: {},
  });
  const deposits = [
    {
      key: "seed:deposit:1",
      kind: "DEPOSIT" as const,
      amount: BigInt(2500000),
      description: "Sandbox funding · Opening balance",
      source: "SANDBOX_FUNDING",
    },
    {
      key: "seed:capture:1",
      kind: "CARD_CAPTURE" as const,
      amount: BigInt(8420),
      description: "Card capture · Northwind Supplies",
      source: "SANDBOX_CAPTURE",
    },
    {
      key: "seed:capture:2",
      kind: "CARD_CAPTURE" as const,
      amount: BigInt(1250),
      description: "Card capture · Cloud hosting",
      source: "SANDBOX_CAPTURE",
    },
  ];
  for (const item of deposits) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.ledgerTransaction.upsert({
        where: {
          businessId_idempotencyKey: { businessId, idempotencyKey: item.key },
        },
        create: {
          businessId,
          accountId: account.id,
          kind: item.kind,
          amountMinor: item.amount,
          currency: "USD",
          description: item.description,
          idempotencyKey: item.key,
          requestHash: item.key,
          sourceType: item.source,
          occurredAt: new Date(),
          environment: "SANDBOX",
        },
        update: {},
      });
      await tx.ledgerEntry.upsert({
        where: {
          transactionId_ledgerAccountId_direction: {
            transactionId: row.id,
            ledgerAccountId: funds.id,
            direction: item.kind === "DEPOSIT" ? "DEBIT" : "CREDIT",
          },
        },
        create: {
          transactionId: row.id,
          ledgerAccountId: funds.id,
          direction: item.kind === "DEPOSIT" ? "DEBIT" : "CREDIT",
          amountMinor: item.amount,
          currency: "USD",
        },
        update: {},
      });
      await tx.ledgerEntry.upsert({
        where: {
          transactionId_ledgerAccountId_direction: {
            transactionId: row.id,
            ledgerAccountId: wallet.id,
            direction: item.kind === "DEPOSIT" ? "CREDIT" : "DEBIT",
          },
        },
        create: {
          transactionId: row.id,
          ledgerAccountId: wallet.id,
          direction: item.kind === "DEPOSIT" ? "CREDIT" : "DEBIT",
          amountMinor: item.amount,
          currency: "USD",
        },
        update: {},
      });
    });
  }
  await prisma.hold.upsert({
    where: {
      businessId_idempotencyKey: { businessId, idempotencyKey: "seed:hold:1" },
    },
    create: {
      businessId,
      accountId: account.id,
      amountMinor: BigInt(12000),
      currency: "USD",
      source: "SANDBOX",
      idempotencyKey: "seed:hold:1",
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
    update: {},
  });
}

/**
 * Demo payment requests.
 *
 * One pending `$5,000` request proves the maker-checker queue on first login;
 * one rejected request proves a terminal decision that posted nothing. Both are
 * idempotent, so re-running the seed never creates a duplicate or a second
 * ledger row.
 */
async function seedPayments(businessId: string): Promise<void> {
  const [employee, admin] = await Promise.all([
    prisma.user.findUnique({ where: { email: "employee@neobank.dev" } }),
    prisma.user.findUnique({ where: { email: "admin@neobank.dev" } }),
  ]);
  if (!employee || !admin) return;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { currency: true, approvalThresholdMinor: true },
  });
  if (!business) return;

  await prisma.paymentRequest.upsert({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey: "seed:payment:pending:1",
      },
    },
    create: {
      businessId,
      createdByUserId: employee.id,
      beneficiaryName: "Acme Supplies",
      beneficiaryReference: "INV-1042",
      memo: "Office chairs",
      amountMinor: BigInt(500000),
      currency: business.currency,
      status: PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
      approvalThresholdMinor: business.approvalThresholdMinor,
      requiredApprovals: 1,
      approvalsCount: 0,
      idempotencyKey: "seed:payment:pending:1",
    },
    update: {
      status: PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
      decisionByUserId: null,
      decidedAt: null,
      approvalsCount: 0,
    },
  });

  const rejected = await prisma.paymentRequest.upsert({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey: "seed:payment:rejected:1",
      },
    },
    create: {
      businessId,
      createdByUserId: employee.id,
      beneficiaryName: "Northwind Travel",
      beneficiaryReference: "TRIP-88",
      memo: "Conference travel",
      amountMinor: BigInt(120000),
      currency: business.currency,
      status: PAYMENT_REQUEST_STATUS.REJECTED,
      approvalThresholdMinor: business.approvalThresholdMinor,
      requiredApprovals: 1,
      approvalsCount: 1,
      decisionByUserId: admin.id,
      decidedAt: new Date(),
      idempotencyKey: "seed:payment:rejected:1",
    },
    update: {
      decisionByUserId: admin.id,
    },
  });

  await prisma.approval.upsert({
    where: {
      paymentRequestId_actorUserId: {
        paymentRequestId: rejected.id,
        actorUserId: admin.id,
      },
    },
    create: {
      businessId,
      paymentRequestId: rejected.id,
      actorUserId: admin.id,
      actorRole: USER_ROLE.ADMIN,
      decision: "REJECTED",
      reason: "Travel is out of policy this quarter",
    },
    update: {},
  });
}

async function main() {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const demo of demoBusinesses) {
    const businessId = await seedBusiness(demo);

    for (const demoUser of demo.users) {
      const user = await prisma.user.upsert({
        where: { email: demoUser.email },
        create: {
          username: demoUser.username,
          email: demoUser.email,
          password,
        },
        update: {
          username: demoUser.username,
          password,
          isDeleted: false,
          deletedAt: null,
        },
      });

      await prisma.businessMember.upsert({
        where: {
          businessId_userId: {
            businessId,
            userId: user.id,
          },
        },
        create: {
          businessId,
          userId: user.id,
          role: demoUser.role,
          status: MEMBERSHIP_STATUS.ACTIVE,
          joinedAt: new Date(),
        },
        update: {
          role: demoUser.role,
          status: MEMBERSHIP_STATUS.ACTIVE,
        },
      });

      console.log(
        `seeded ${demo.legalName} · ${demoUser.role.padEnd(10)} ${demoUser.email}`,
      );
    }

    if (demo.complete) {
      await seedVerification(
        businessId,
        demo.verificationSessionId ?? "seed-demo-kyb-session",
      );
      await seedLedger(businessId);
      if (demo.seedFinance !== false) {
        await seedPayments(businessId);
      }
    }

    console.log(`  business ${businessId} (${demo.status})\n`);
  }

  console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
