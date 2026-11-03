/**
 * PostgreSQL connection, owned by the DI container.
 *
 * Everything that talks to the database goes through the singleton PrismaClient
 * created here. Nothing else in the codebase constructs a client, so swapping
 * the driver later means editing this file and one container binding — the
 * repositories only ever receive the client through `TYPES.PrismaClient`.
 *
 * @author aliasgarbootwala3@gmail.com

 */

import { inject, injectable } from "inversify";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  IDatabase,
  DbClient,
  OMITTED_FIELDS,
} from "../types/database.types.js";
import { TYPES } from "./types.js";
import Logger from "../utils/logger.js";

@injectable()
export default class PrismaDatabase implements IDatabase {
  private readonly client: DbClient;
  private readonly logger: Logger;
  private readonly connectionString: string;
  private connected = false;

  constructor(@inject(TYPES.Logger) logger: Logger) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is not defined");
    }

    this.logger = logger;

    this.connectionString = connectionString;

    const adapter = new PrismaPg({ connectionString });

    /*
     * `OMITTED_FIELDS` is the equivalent of the old mongoose setup:
     * `password` behaves like a `select: false` field plus the `toJSON`
     * transform that stripped it — it is left out of every query result
     * unless a query explicitly asks for it back with
     * `omit: { password: false }`.
     */
    this.client = new PrismaClient({
      adapter,
      omit: OMITTED_FIELDS,
    });
  }

  getClient(): DbClient {
    return this.client;
  }

  async connect(): Promise<void> {
    /*
     * `$connect()` alone is not enough to prove anything: with a driver
     * adapter the underlying pool opens lazily, so it resolves even when the
     * server is down and the failure would otherwise only surface on the first
     * query. One round trip forces the connection for real, which keeps a dead
     * database from looking like a healthy boot.
     */
    try {
      await this.client.$connect();

      await this.client.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        `Could not reach PostgreSQL at ${this.describeTarget()}: ${this.describeCause(error)}`,
        { cause: error },
      );
    }

    this.connected = true;

    this.logger.info("Connected to PostgreSQL", {
      target: this.describeTarget(),
    });
  }

  /** Host and database only — never the password. */
  private describeTarget(): string {
    try {
      const url = new URL(this.connectionString);

      return `${url.hostname}:${url.port || 5432}/${url.pathname.replace("/", "")}`;
    } catch {
      return "an unparseable DATABASE_URL";
    }
  }

  /**
   * The driver hides the interesting part (`ECONNREFUSED`, auth failures) deep
   * in `cause` / `errors` chains, so walk the whole tree, collapse the noisy
   * multi-line Prisma wrapper and keep the parts a human can act on.
   */
  private describeCause(error: unknown): string {
    const parts: string[] = [];

    const visit = (node: unknown, depth: number): void => {
      if (!node || depth > 5) {
        return;
      }

      if (typeof node === "string") {
        add(node);
      } else if (node instanceof Error) {
        add(node.message);
      }

      const asRecord = node as {
        code?: unknown;
        cause?: unknown;
        errors?: unknown;
      };

      if (typeof asRecord.code === "string") {
        add(asRecord.code);
      }

      /* AggregateError from a pool that tried several addresses. */
      if (Array.isArray(asRecord.errors)) {
        for (const nested of asRecord.errors) {
          visit(nested, depth + 1);
        }
      }

      visit(asRecord.cause, depth + 1);
    };

    const add = (raw: string): void => {
      const text = raw.replace(/\s+/g, " ").trim();

      /* Prisma's generic wrapper adds nothing here. */
      if (!text || /^Invalid `prisma\./.test(text) || parts.includes(text)) {
        return;
      }

      parts.push(text);
    };

    visit(error, 0);

    return parts.join(" -> ") || "no further detail available";
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();

    this.connected = false;

    this.logger.info("Disconnected from PostgreSQL");
  }

  isConnected(): boolean {
    return this.connected;
  }
}
