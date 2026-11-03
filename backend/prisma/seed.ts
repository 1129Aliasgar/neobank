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
  users: DemoUser[];
}

const demoBusinesses: DemoBusiness[] = [
  {
    legalName: "NeoBank Demo Co",
    status: BUSINESS_STATUS.ACTIVE,
    complete: true,
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
    ? COMPLETE_PROFILE
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
        },
      })
    : await prisma.business.create({
        data: {
          ...profile,
          legalName: demo.legalName,
          country: "US",
          currency: "USD",
          status: demo.status,
        },
      });

  return business.id;
}

async function seedVerification(businessId: string): Promise<void> {
  /*
   * A synthetic approval for the demo business. `environment = SANDBOX` and a
   * scenario slug make it obvious in the API and the UI that this is not a
   * real KYB decision.
   */
  await prisma.verification.upsert({
    where: { providerSessionId: "seed-demo-kyb-session" },
    create: {
      businessId,
      provider: VERIFICATION_PROVIDER.DIDIT,
      providerSessionId: "seed-demo-kyb-session",
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
      await seedVerification(businessId);
      await seedLedger(businessId);
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
