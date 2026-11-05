/**
 * Destructive demo reset: remove every row, then let the caller re-apply
 * migrations and the seed.
 *
 * This is deliberately NOT part of any deploy or start command. It refuses to
 * run unless `CLEAN_DB_CONFIRM=YES` is present, prints only the database host
 * and name, and never prints the connection string.
 *
 * Usage (PowerShell):
 *   $env:CLEAN_DB_CONFIRM="YES"; npm run db:reset:demo
 *
 * Usage (bash):
 *   CLEAN_DB_CONFIRM=YES npm run db:reset:demo
 *
 * The reset drops the `public` schema, which also removes the Prisma migration
 * history. `db:reset:demo` therefore runs `prisma migrate deploy` before the
 * seed. Ledger triggers cannot block this because the tables themselves are
 * dropped, not truncated.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const confirmation = process.env.CLEAN_DB_CONFIRM?.trim().toUpperCase();

if (confirmation !== "YES") {
  console.error(
    "Refusing to clean the database. Set CLEAN_DB_CONFIRM=YES to confirm.",
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not defined.");
  process.exit(1);
}

const target = new URL(connectionString);
console.log(
  `Cleaning PostgreSQL database ${target.pathname.replace("/", "")} at ${target.hostname}…`,
);

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

try {
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  console.log("Public schema dropped and recreated (all rows removed).");
  console.log("Next: npm run db:migrate:deploy && npm run db:seed");
} finally {
  await db.$disconnect();
}
