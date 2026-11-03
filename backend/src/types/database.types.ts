/**
 * @author aliasgarbootwala3@gmail.com
 */

import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Fields the client never returns unless a query asks for them back with
 * `omit: { ...: false }`.
 *
 * This is the equivalent of the old mongoose schema, where `password` was
 * declared `select: false` and stripped again by a `toJSON` transform. Keeping
 * the literal here and the type derived from it means the runtime config in
 * `config/database.ts` and the types seen by repositories cannot drift apart.
 */
export const OMITTED_FIELDS = {
  user: {
    password: true,
  },
} as const;

/** The injected client, typed so that omitted fields are absent by default. */
export type DbClient = PrismaClient<never, typeof OMITTED_FIELDS>;

export interface IDatabase {
  /**
   * The single shared client. Repositories depend on this instead of
   * importing a driver, which keeps the database an injected dependency.
   */
  getClient(): DbClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
