/**
 * Prisma CLI config.
 *
 * `dotenv/config` is used instead of the project's own config module because
 * `prisma generate` runs outside the app and must not create a database client.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    /*
     * Read straight from process.env instead of the typed `env()` helper so
     * that `prisma generate` keeps working in environments that only type-check
     * and never have a database URL (CI, Docker build stage). `database.ts`
     * fails loudly when DATABASE_URL is missing at runtime.
     */
    url: process.env.DATABASE_URL ?? "",
  },
});
