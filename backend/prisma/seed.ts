/**
 * Demo seed.
 *
 * Idempotent: running it twice leaves the same demo business and four members,
 * with passwords reset to the documented demo value. Never point this at a
 * database that holds anything you care about.
 *
 * Roles live on `BusinessMember`, so the demo business is created first and
 * each user is attached to it. The owner row is what a real registration
 * produces.
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
  MEMBERSHIP_STATUS,
  USER_ROLE,
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
const DEMO_BUSINESS = "NeoBank Demo Co";

const demoUsers: Array<{
  username: string;
  email: string;
  role: UserRole;
}> = [
  { username: "owner", email: "owner@neobank.dev", role: USER_ROLE.OWNER },
  { username: "admin", email: "admin@neobank.dev", role: USER_ROLE.ADMIN },
  {
    username: "employee",
    email: "employee@neobank.dev",
    role: USER_ROLE.EMPLOYEE,
  },
  { username: "ops", email: "ops@neobank.dev", role: USER_ROLE.OPERATIONS },
];

async function main() {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);

  const business =
    (await prisma.business.findFirst({
      where: { legalName: DEMO_BUSINESS },
    })) ??
    (await prisma.business.create({
      data: {
        legalName: DEMO_BUSINESS,
        country: "US",
        currency: "USD",
        status: BUSINESS_STATUS.ACTIVE,
      },
    }));

  for (const demo of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      create: {
        username: demo.username,
        email: demo.email,
        password,
      },
      update: {
        username: demo.username,
        password,
        isDeleted: false,
        deletedAt: null,
      },
    });

    await prisma.businessMember.upsert({
      where: {
        businessId_userId: {
          businessId: business.id,
          userId: user.id,
        },
      },
      create: {
        businessId: business.id,
        userId: user.id,
        role: demo.role,
        status: MEMBERSHIP_STATUS.ACTIVE,
        joinedAt: new Date(),
      },
      update: {
        role: demo.role,
        status: MEMBERSHIP_STATUS.ACTIVE,
      },
    });

    console.log(`seeded ${demo.role.padEnd(10)} ${demo.email}`);
  }

  console.log(`\nBusiness: ${business.legalName} (${business.id})`);
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
