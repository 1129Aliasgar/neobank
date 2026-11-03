import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import type { DbClient } from "../types/database.types.js";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import {
  BUSINESS_STATUS,
  USER_ROLE,
  type UserRole,
} from "../constants/constants.js";
import { LEDGER_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import { auditEntry } from "../utils/audit.js";
import {
  decodeCursor,
  encodeCursor,
  hashRequest,
  jsonMoney,
  parseMinorUnits,
} from "../utils/money.js";

type Tx = Prisma.TransactionClient;
type Line = {
  code: "1010" | "2010";
  direction: "DEBIT" | "CREDIT";
  amountMinor: bigint;
};

function ensureOperator(role: UserRole) {
  if (role !== USER_ROLE.OWNER && role !== USER_ROLE.ADMIN)
    throw new ApiError(LEDGER_ERRORS.EMPLOYEE_BALANCE_FORBIDDEN, 403);
}

function ensureActive(status: string) {
  if (status !== BUSINESS_STATUS.ACTIVE)
    throw new ApiError(LEDGER_ERRORS.BUSINESS_NOT_ACTIVE, 409);
}

function mapTransaction(row: Record<string, unknown>) {
  const entries =
    (row.entries as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountMinor: jsonMoney(row.amountMinor as bigint),
    currency: row.currency,
    description: row.description,
    occurredAt: row.occurredAt,
    postedAt: row.postedAt,
    environment: row.environment,
    source: { type: row.sourceType, id: row.sourceId },
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    lines: entries.map((entry) => ({
      accountCode: (entry.ledgerAccount as { code: string }).code,
      accountName: (entry.ledgerAccount as { name: string }).name,
      direction: entry.direction,
      amountMinor: jsonMoney(entry.amountMinor as bigint),
    })),
    reversedBy: row.reversedBy
      ? { id: (row.reversedBy as { id: string }).id }
      : null,
    reverses: row.reverses ? { id: (row.reverses as { id: string }).id } : null,
  };
}

@injectable()
export default class LedgerService {
  constructor(@inject(TYPES.PrismaClient) private readonly db: DbClient) {}

  private async account(tx: Tx, businessId: string, requireActive = true) {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: { status: true, currency: true },
    });
    if (!business) throw new ApiError(LEDGER_ERRORS.BUSINESS_NOT_ACTIVE, 409);
    if (requireActive) ensureActive(business.status);
    let account = await tx.account.findUnique({
      where: {
        businessId_currency: { businessId, currency: business.currency },
      },
    });
    if (!account) {
      account = await tx.account.create({
        data: {
          businessId,
          currency: business.currency,
          environment: "SANDBOX",
        },
      });
      await tx.ledgerAccount.createMany({
        data: [
          {
            businessId,
            accountId: account.id,
            code: "1010",
            name: "CUSTOMER_FUNDS",
            type: "ASSET",
            currency: business.currency,
          },
          {
            businessId,
            accountId: account.id,
            code: "2010",
            name: "WALLET",
            type: "LIABILITY",
            currency: business.currency,
          },
        ],
      });
    }
    return { account, currency: business.currency };
  }

  private async balance(tx: Tx, accountId: string) {
    const rows = await tx.ledgerEntry.groupBy({
      by: ["direction"],
      where: { ledgerAccount: { accountId, code: "2010" } },
      _sum: { amountMinor: true },
    });
    const ledgerMinor =
      (rows.find((row) => row.direction === "CREDIT")?._sum.amountMinor ?? 0n) -
      (rows.find((row) => row.direction === "DEBIT")?._sum.amountMinor ?? 0n);
    const now = new Date();
    await tx.hold.updateMany({
      where: { accountId, status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "EXPIRED", releasedAt: now },
    });
    const holds = await tx.hold.aggregate({
      where: { accountId, status: "ACTIVE", expiresAt: { gt: now } },
      _sum: { amountMinor: true },
    });
    const holdMinor = holds._sum.amountMinor ?? 0n;
    return {
      ledgerMinor,
      holdMinor,
      availableMinor: ledgerMinor - holdMinor,
      asOf: now,
    };
  }

  async getAccount(businessId: string, role: UserRole) {
    ensureOperator(role);
    return this.db.$transaction(async (tx) => {
      const { account, currency } = await this.account(tx, businessId);
      const balance = await this.balance(tx, account.id);
      return {
        account: {
          id: account.id,
          currency,
          status: account.status,
          environment: account.environment,
          openedAt: account.openedAt,
          funding: { driver: "SANDBOX", simulated: true },
          balance: {
            ...balance,
            ledgerMinor: jsonMoney(balance.ledgerMinor),
            holdMinor: jsonMoney(balance.holdMinor),
            availableMinor: jsonMoney(balance.availableMinor),
          },
        },
      };
    });
  }

  private async post(
    tx: Tx,
    input: {
      businessId: string;
      accountId: string;
      currency: string;
      kind: "DEPOSIT" | "CARD_CAPTURE" | "REVERSAL";
      amountMinor: bigint;
      description: string;
      idempotencyKey: string;
      requestHash: string;
      sourceType: string;
      sourceId?: string;
      occurredAt?: Date;
      actorUserId?: string | null;
      lines: Line[];
      reversesTransactionId?: string;
    },
  ) {
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${input.accountId} FOR UPDATE`;
    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: input.businessId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        entries: { include: { ledgerAccount: true } },
        reversedBy: true,
        reverses: true,
      },
    });
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REUSED, 409);
      return {
        transaction: mapTransaction(
          existing as unknown as Record<string, unknown>,
        ),
        replayed: true,
      };
    }
    const created = await tx.ledgerTransaction.create({
      data: {
        businessId: input.businessId,
        accountId: input.accountId,
        currency: input.currency,
        kind: input.kind,
        amountMinor: input.amountMinor,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        occurredAt: input.occurredAt ?? new Date(),
        createdByUserId: input.actorUserId,
        environment: "SANDBOX",
        reversesTransactionId: input.reversesTransactionId,
        entries: {
          create: await Promise.all(
            input.lines.map(async (line) => ({
              ledgerAccountId: (
                await tx.ledgerAccount.findUniqueOrThrow({
                  where: {
                    accountId_code: {
                      accountId: input.accountId,
                      code: line.code,
                    },
                  },
                })
              ).id,
              direction: line.direction,
              amountMinor: line.amountMinor,
              currency: input.currency,
            })),
          ),
        },
      },
      include: {
        entries: { include: { ledgerAccount: true } },
        reversedBy: true,
        reverses: true,
      },
    });
    return {
      transaction: mapTransaction(
        created as unknown as Record<string, unknown>,
      ),
      replayed: false,
    };
  }

  async deposit(
    businessId: string,
    userId: string,
    role: UserRole,
    key: string,
    body: { amountMinor: unknown; memo?: unknown },
  ) {
    ensureOperator(role);
    if (!/^[A-Za-z0-9:_-]{8,64}$/.test(key))
      throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
    const amountMinor = parseMinorUnits(body.amountMinor);
    if (amountMinor > env.ledger.depositMaxMinor)
      throw new ApiError(LEDGER_ERRORS.AMOUNT_LIMIT_EXCEEDED, 422);
    const description =
      typeof body.memo === "string" && body.memo.trim()
        ? `Sandbox funding · ${body.memo.trim().slice(0, 120)}`
        : "Sandbox funding";
    return this.db.$transaction(async (tx) => {
      const { account, currency } = await this.account(tx, businessId);
      if (account.status !== "ACTIVE")
        throw new ApiError(LEDGER_ERRORS.ACCOUNT_NOT_ACTIVE, 409);
      const requestHash = hashRequest({
        amountMinor: amountMinor.toString(),
        currency,
        sourceType: "SANDBOX_FUNDING",
        memo: description,
      });
      const today = new Date();
      const start = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      );
      const daily = await tx.ledgerTransaction.aggregate({
        where: {
          businessId,
          kind: "DEPOSIT",
          sourceType: "SANDBOX_FUNDING",
          postedAt: { gte: start },
        },
        _sum: { amountMinor: true },
      });
      if (
        (daily._sum.amountMinor ?? 0n) + amountMinor >
        env.ledger.fundingDailyLimitMinor
      )
        throw new ApiError(LEDGER_ERRORS.FUNDING_LIMIT_EXCEEDED, 409);
      const posted = await this.post(tx, {
        businessId,
        accountId: account.id,
        currency,
        kind: "DEPOSIT",
        amountMinor,
        description,
        idempotencyKey: key,
        requestHash,
        sourceType: "SANDBOX_FUNDING",
        actorUserId: userId,
        lines: [
          { code: "1010", direction: "DEBIT", amountMinor },
          { code: "2010", direction: "CREDIT", amountMinor },
        ],
      });
      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: userId,
          action: "FUNDS_ADDED",
          resourceType: "LedgerTransaction",
          resourceId: (posted.transaction as { id: string }).id,
          metadata: {
            transactionId: (posted.transaction as { id: string }).id,
          },
        }),
      });
      const balance = await this.balance(tx, account.id);
      return {
        ...posted,
        balance: {
          ...balance,
          ledgerMinor: jsonMoney(balance.ledgerMinor),
          holdMinor: jsonMoney(balance.holdMinor),
          availableMinor: jsonMoney(balance.availableMinor),
        },
        funding: { driver: "SANDBOX", simulated: true },
      };
    });
  }

  async listTransactions(
    businessId: string,
    role: UserRole,
    query: { limit?: string; cursor?: string; kind?: string },
  ) {
    ensureOperator(role);
    const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.ledgerTransaction.findMany({
      where: {
        businessId,
        ...(query.kind ? { kind: query.kind as never } : {}),
        ...(cursor
          ? {
              OR: [
                { postedAt: { lt: cursor.postedAt } },
                { postedAt: cursor.postedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ postedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        entries: { include: { ledgerAccount: true } },
        reversedBy: true,
        reverses: true,
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      transactions: page.map((row) =>
        mapTransaction(row as unknown as Record<string, unknown>),
      ),
      nextCursor: hasMore && last ? encodeCursor(last.postedAt, last.id) : null,
    };
  }

  async getTransaction(businessId: string, role: UserRole, id: string) {
    ensureOperator(role);
    const row = await this.db.ledgerTransaction.findFirst({
      where: { id, businessId },
      include: {
        entries: { include: { ledgerAccount: true } },
        reversedBy: true,
        reverses: true,
      },
    });
    if (!row) throw new ApiError(LEDGER_ERRORS.TRANSACTION_NOT_FOUND, 404);
    return {
      transaction: mapTransaction(row as unknown as Record<string, unknown>),
    };
  }

  async reserve(
    businessId: string,
    userId: string,
    role: UserRole,
    key: string,
    body: { amountMinor: unknown; memo?: unknown; expiresInMinutes?: unknown },
  ) {
    ensureOperator(role);
    if (!/^[A-Za-z0-9:_-]{8,64}$/.test(key))
      throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
    const amountMinor = parseMinorUnits(body.amountMinor);
    const minutes = Math.min(
      Math.max(Number(body.expiresInMinutes ?? 120) || 120, 1),
      24 * 60,
    );
    return this.db.$transaction(async (tx) => {
      const { account, currency } = await this.account(tx, businessId);
      if (account.status !== "ACTIVE")
        throw new ApiError(LEDGER_ERRORS.ACCOUNT_NOT_ACTIVE, 409);
      const current = await this.balance(tx, account.id);
      if (current.availableMinor < amountMinor)
        throw new ApiError(LEDGER_ERRORS.INSUFFICIENT_FUNDS, 409);
      const existing = await tx.hold.findUnique({
        where: {
          businessId_idempotencyKey: { businessId, idempotencyKey: key },
        },
      });
      if (existing)
        return {
          hold: this.holdView(existing),
          balance: this.moneyBalance(await this.balance(tx, account.id)),
          replayed: true,
        };
      const hold = await tx.hold.create({
        data: {
          businessId,
          accountId: account.id,
          amountMinor,
          currency,
          source: "SANDBOX",
          idempotencyKey: key,
          expiresAt: new Date(Date.now() + minutes * 60_000),
        },
      });
      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: userId,
          action: "HOLD_CREATED",
          resourceType: "Hold",
          resourceId: hold.id,
          metadata: { holdId: hold.id },
        }),
      });
      return {
        hold: this.holdView(hold),
        balance: this.moneyBalance(await this.balance(tx, account.id)),
        sandbox: true,
        replayed: false,
      };
    });
  }

  private holdView(hold: {
    id: string;
    amountMinor: bigint;
    capturedMinor: bigint;
    status: string;
    expiresAt: Date;
  }) {
    return {
      id: hold.id,
      amountMinor: jsonMoney(hold.amountMinor),
      capturedMinor: jsonMoney(hold.capturedMinor),
      status: hold.status,
      expiresAt: hold.expiresAt,
      sandbox: true,
    };
  }
  private moneyBalance(balance: {
    ledgerMinor: bigint;
    holdMinor: bigint;
    availableMinor: bigint;
    asOf: Date;
  }) {
    return {
      ...balance,
      ledgerMinor: jsonMoney(balance.ledgerMinor),
      holdMinor: jsonMoney(balance.holdMinor),
      availableMinor: jsonMoney(balance.availableMinor),
    };
  }

  async capture(
    businessId: string,
    userId: string,
    role: UserRole,
    holdId: string,
    key: string,
    body: { amountMinor: unknown; memo?: unknown },
  ) {
    ensureOperator(role);
    const amount = parseMinorUnits(body.amountMinor);
    return this.db.$transaction(async (tx) => {
      const hold = await tx.hold.findFirst({
        where: { id: holdId, businessId },
      });
      if (!hold) throw new ApiError(LEDGER_ERRORS.TRANSACTION_NOT_FOUND, 404);
      const { account, currency } = await this.account(tx, businessId);
      if (hold.status !== "ACTIVE" || hold.expiresAt <= new Date())
        throw new ApiError(LEDGER_ERRORS.HOLD_NOT_ACTIVE, 409);
      if (amount > hold.amountMinor)
        throw new ApiError(LEDGER_ERRORS.CAPTURE_EXCEEDS_HOLD, 409);
      const description =
        typeof body.memo === "string" && body.memo.trim()
          ? `Card capture · ${body.memo.trim().slice(0, 120)}`
          : "Sandbox card capture";
      const posted = await this.post(tx, {
        businessId,
        accountId: account.id,
        currency,
        kind: "CARD_CAPTURE",
        amountMinor: amount,
        description,
        idempotencyKey: key,
        requestHash: hashRequest({
          amountMinor: amount.toString(),
          holdId,
          kind: "CARD_CAPTURE",
        }),
        sourceType: "SANDBOX_CAPTURE",
        sourceId: hold.id,
        actorUserId: userId,
        lines: [
          { code: "2010", direction: "DEBIT", amountMinor: amount },
          { code: "1010", direction: "CREDIT", amountMinor: amount },
        ],
      });
      await tx.hold.update({
        where: { id: hold.id },
        data: {
          status: "CAPTURED",
          capturedMinor: amount,
          capturedAt: new Date(),
          releasedAt: new Date(),
        },
      });
      return {
        ...posted,
        balance: this.moneyBalance(await this.balance(tx, account.id)),
        sandbox: true,
        replayed: posted.replayed,
      };
    });
  }

  async release(
    businessId: string,
    role: UserRole,
    holdId: string,
    key: string,
  ) {
    ensureOperator(role);
    if (!/^[A-Za-z0-9:_-]{8,64}$/.test(key))
      throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
    return this.db.$transaction(async (tx) => {
      const hold = await tx.hold.findFirst({
        where: { id: holdId, businessId },
      });
      if (!hold) throw new ApiError(LEDGER_ERRORS.TRANSACTION_NOT_FOUND, 404);
      if (hold.status !== "ACTIVE")
        throw new ApiError(LEDGER_ERRORS.HOLD_NOT_ACTIVE, 409);
      await tx.hold.update({
        where: { id: hold.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
      return {
        hold: this.holdView({ ...hold, status: "RELEASED" }),
        sandbox: true,
      };
    });
  }

  async integrity() {
    const transactions = await this.db.ledgerTransaction.findMany({
      select: {
        id: true,
        amountMinor: true,
        entries: { select: { direction: true, amountMinor: true } },
      },
    });
    const failures = transactions
      .filter(
        (t) =>
          t.entries.length < 2 ||
          t.entries.reduce(
            (sum, e) =>
              sum + (e.direction === "DEBIT" ? e.amountMinor : -e.amountMinor),
            0n,
          ) !== 0n ||
          t.entries
            .filter((e) => e.direction === "DEBIT")
            .reduce((sum, e) => sum + e.amountMinor, 0n) !== t.amountMinor,
      )
      .map((t) => t.id);
    const expired = await this.db.hold.count({
      where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
    });
    const checks = [
      {
        name: "balanced_transactions",
        ok: failures.length === 0,
        failures: failures.length,
        sample: failures.slice(0, 5),
      },
      {
        name: "min_two_lines",
        ok: failures.length === 0,
        failures: failures.length,
      },
      {
        name: "header_matches_lines",
        ok: failures.length === 0,
        failures: failures.length,
      },
      { name: "expired_active_holds", ok: expired === 0, failures: expired },
    ];
    return {
      ok: checks.every((check) => check.ok),
      checkedAt: new Date(),
      checks,
    };
  }

  async reverse(
    businessId: string,
    userId: string,
    role: UserRole,
    id: string,
    key: string,
  ) {
    ensureOperator(role);
    if (!/^[A-Za-z0-9:_-]{8,64}$/.test(key))
      throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REQUIRED, 400);
    return this.db.$transaction(async (tx) => {
      const original = await tx.ledgerTransaction.findFirst({
        where: { id, businessId },
        include: {
          entries: { include: { ledgerAccount: true } },
          reversedBy: true,
        },
      });
      if (!original)
        throw new ApiError(LEDGER_ERRORS.TRANSACTION_NOT_FOUND, 404);
      if (original.kind === "REVERSAL")
        throw new ApiError(LEDGER_ERRORS.REVERSAL_OF_REVERSAL, 409);
      if (original.status === "REVERSED" || original.reversedBy)
        throw new ApiError(LEDGER_ERRORS.ALREADY_REVERSED, 409);
      const { account, currency } = await this.account(tx, businessId);
      const posted = await this.post(tx, {
        businessId,
        accountId: account.id,
        currency,
        kind: "REVERSAL",
        amountMinor: original.amountMinor,
        description: `Reversal · ${original.description}`,
        idempotencyKey: key,
        requestHash: hashRequest({ id, kind: "REVERSAL" }),
        sourceType: "MANUAL_REVERSAL",
        sourceId: original.id,
        actorUserId: userId,
        reversesTransactionId: original.id,
        lines: original.entries.map((entry) => ({
          code: (entry.ledgerAccount.code === "1010" ? "1010" : "2010") as
            "1010" | "2010",
          direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
          amountMinor: entry.amountMinor,
        })),
      });
      await tx.ledgerTransaction.update({
        where: { id: original.id },
        data: { status: "REVERSED" },
      });
      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: userId,
          action: "TRANSACTION_REVERSED",
          resourceType: "LedgerTransaction",
          resourceId: original.id,
          metadata: { transactionId: original.id },
        }),
      });
      return {
        ...posted,
        balance: this.moneyBalance(await this.balance(tx, account.id)),
      };
    });
  }
}
