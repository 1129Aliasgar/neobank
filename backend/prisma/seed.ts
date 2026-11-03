/**
 * Demo seed.
 *
 * Idempotent: running it twice leaves the same four accounts, with passwords
 * reset to the documented demo value. Never point this at a database that holds
 * anything you care about.
 *
 * Usage: npm run db:seed
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { USER_ROLE, type UserRole } from "../src/constants/constants.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEMO_PASSWORD = "NeoBank@123";

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

  for (const demo of demoUsers) {
    await prisma.user.upsert({
      where: { email: demo.email },
      create: {
        username: demo.username,
        email: demo.email,
        password,
        role: demo.role,
      },
      update: {
        username: demo.username,
        password,
        role: demo.role,
        isDeleted: false,
        deletedAt: null,
      },
    });

    console.log(`seeded ${demo.role.padEnd(10)} ${demo.email}`);
  }

  console.log(`\nDemo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
