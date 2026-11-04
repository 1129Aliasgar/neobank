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
import { LEDGER_ERRORS, PAYMENT_ERRORS } from "../constants/error.js";
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

/** Internal outcome of a card authorization decision. */
export type CardAuthorizationOutcome = {
  recorded: boolean;
  approved: boolean;
  authorizationId: string | null;
  holdId: string | null;
  replayed: boolean;
  reason?: string;
};

/** Internal outcome of a capture / void / reversal. */
export type CardCaptureOutcome = {
  applied: boolean;
  replayed: boolean;
  reason?: string;
  capturedMinor?: bigint;
};

function ensureOperator(role: UserRole) {
  if (role !== USER_ROLE.OWNER && role !== USER_ROLE.ADMIN)
    throw new ApiError(LEDGER_ERRORS.EMPLOYEE_BALANCE_FORBIDDEN, 403);
}

/**
 * Manual reversal is an operations control, not a customer action. An owner or
 * admin reversing their own payment would bypass the maker-checker rule that
 * Module 5 adds, so this is deliberately narrower than `ensureOperator`.
 */
function ensureOperations(role: UserRole) {
  if (role !== USER_ROLE.OPERATIONS)
    throw new ApiError(LEDGER_ERRORS.OPERATIONS_ONLY, 403);
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
    const holds = await tx.hold.findMany({
      where: { accountId, status: "ACTIVE", expiresAt: { gt: now } },
      select: { amountMinor: true, capturedMinor: true },
    });
    /*
     * A partial capture keeps the authorization hold ACTIVE but only the
     * uncaptured remainder should reduce available funds. Summing the original
     * amount here was over-reserving the wallet until the hold expired.
     */
    const holdMinor = holds.reduce(
      (sum, hold) => sum + (hold.amountMinor - hold.capturedMinor),
      0n,
    );
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
      kind: "DEPOSIT" | "CARD_CAPTURE" | "CARD_REFUND" | "REVERSAL" | "PAYMENT";
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
      if (amount > hold.amountMinor - hold.capturedMinor)
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
          capturedMinor: hold.capturedMinor + amount,
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

  /* ----------------------------------------------------------------------- *
   * Card money primitives
   *
   * CardService calls these from the Lithic webhook pipeline. They are not
   * exposed over HTTP and deliberately take a business id, not a JWT role:
   * the provider event is the authority, the adapter is not.
   * ----------------------------------------------------------------------- */

  async authorizeCard(input: {
    businessId: string;
    cardId: string;
    providerAuthorizationId: string;
    amountMinor: bigint;
    cardActive: boolean;
    declined?: boolean;
    merchantName?: string | null;
    merchantMcc?: string | null;
    providerCreatedAt?: Date;
  }): Promise<CardAuthorizationOutcome> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.cardAuthorization.findUnique({
        where: {
          providerAuthorizationId: input.providerAuthorizationId,
        },
      });

      if (existing) {
        return {
          recorded: true,
          approved: existing.status === "APPROVED",
          authorizationId: existing.id,
          holdId: null,
          replayed: true,
        };
      }

      const business = await tx.business.findUnique({
        where: { id: input.businessId },
        select: { status: true, currency: true },
      });

      if (!business) {
        return {
          recorded: false,
          approved: false,
          authorizationId: null,
          holdId: null,
          replayed: false,
          reason: "business-missing",
        };
      }

      let account = await tx.account.findUnique({
        where: {
          businessId_currency: {
            businessId: input.businessId,
            currency: business.currency,
          },
        },
      });

      if (!account && business.status === BUSINESS_STATUS.ACTIVE) {
        account = (await this.account(tx, input.businessId)).account;
      }

      if (!account) {
        return {
          recorded: false,
          approved: false,
          authorizationId: null,
          holdId: null,
          replayed: false,
          reason: "account-missing",
        };
      }

      const funds = await this.balance(tx, account.id);
      const approved =
        !input.declined &&
        business.status === BUSINESS_STATUS.ACTIVE &&
        account.status === "ACTIVE" &&
        input.cardActive &&
        input.amountMinor > 0n &&
        input.amountMinor <= funds.availableMinor;

      const authorization = await tx.cardAuthorization.create({
        data: {
          businessId: input.businessId,
          accountId: account.id,
          cardId: input.cardId,
          providerAuthorizationId: input.providerAuthorizationId,
          amountMinor: input.amountMinor,
          currency: business.currency,
          status: approved ? "APPROVED" : "DECLINED",
          merchantName: input.merchantName ?? null,
          merchantMcc: input.merchantMcc ?? null,
          providerCreatedAt: input.providerCreatedAt ?? new Date(),
        },
      });

      let holdId: string | null = null;

      if (approved) {
        const hold = await tx.hold.create({
          data: {
            businessId: input.businessId,
            accountId: account.id,
            amountMinor: input.amountMinor,
            currency: business.currency,
            status: "ACTIVE",
            source: "CARD_AUTHORIZATION",
            sourceId: input.providerAuthorizationId,
            idempotencyKey: `lithic-auth:${input.providerAuthorizationId}`,
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        });

        holdId = hold.id;
      }

      await tx.auditLog.create({
        data: auditEntry({
          businessId: input.businessId,
          actorType: "SYSTEM",
          actorId: null,
          action: approved
            ? "CARD_AUTHORIZATION_APPROVED"
            : "CARD_AUTHORIZATION_DECLINED",
          resourceType: "CardAuthorization",
          resourceId: authorization.id,
          metadata: { cardId: input.cardId },
        }),
      });

      return {
        recorded: true,
        approved,
        authorizationId: authorization.id,
        holdId,
        replayed: false,
      };
    });
  }

  async captureCard(input: {
    businessId: string;
    cardId: string;
    providerAuthorizationId: string;
    providerTransactionId: string;
    amountMinor: bigint;
    occurredAt?: Date;
  }): Promise<CardCaptureOutcome> {
    return this.db.$transaction(async (tx) => {
      const authorization = await tx.cardAuthorization.findUnique({
        where: {
          providerAuthorizationId: input.providerAuthorizationId,
        },
      });

      if (!authorization) {
        return {
          applied: false,
          replayed: false,
          reason: "authorization-missing",
        };
      }

      const existing = await tx.cardTransaction.findUnique({
        where: { providerTransactionId: input.providerTransactionId },
      });

      if (existing) {
        return {
          applied: true,
          replayed: true,
          capturedMinor: authorization.capturedMinor,
        };
      }

      if (
        authorization.status === "DECLINED" ||
        authorization.status === "REVERSED" ||
        authorization.status === "CAPTURED"
      ) {
        return {
          applied: false,
          replayed: false,
          reason: "authorization-not-capturable",
        };
      }

      /*
       * A clearing is the actual merchant settlement, which may differ from the
       * authorization in either direction. Capping it at the authorized amount
       * would understate the ledger and leave the provider and NeoBank
       * disagreeing. Post the real amount; the hold only reserves what it
       * reserved, and the excess is an authorised overdraft visible in the
       * available balance.
       */
      const capture = input.amountMinor;

      if (capture <= 0n) {
        return {
          applied: false,
          replayed: false,
          reason: "nothing-to-capture",
        };
      }

      const remaining = authorization.amountMinor - authorization.capturedMinor;
      const overCaptured = capture > remaining ? capture - remaining : 0n;

      const account = await tx.account.findUniqueOrThrow({
        where: { id: authorization.accountId },
        select: { currency: true },
      });

      const posted = await this.post(tx, {
        businessId: input.businessId,
        accountId: authorization.accountId,
        currency: account.currency,
        kind: "CARD_CAPTURE",
        amountMinor: capture,
        description: `Lithic card purchase${
          authorization.merchantName ? ` · ${authorization.merchantName}` : ""
        }`,
        idempotencyKey: `lithic-capture:${input.providerTransactionId}`,
        requestHash: hashRequest({
          token: input.providerTransactionId,
          amountMinor: capture.toString(),
        }),
        sourceType: "LITHIC_CARD_TRANSACTION",
        sourceId: input.providerTransactionId,
        occurredAt: input.occurredAt,
        lines: [
          { code: "2010", direction: "DEBIT", amountMinor: capture },
          { code: "1010", direction: "CREDIT", amountMinor: capture },
        ],
      });

      await tx.cardTransaction.create({
        data: {
          businessId: input.businessId,
          accountId: authorization.accountId,
          cardId: input.cardId,
          authorizationId: authorization.id,
          providerTransactionId: input.providerTransactionId,
          kind: "CAPTURE",
          amountMinor: capture,
          currency: account.currency,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });

      const nextCaptured = authorization.capturedMinor + capture;

      /*
       * A clearing is final: the merchant settled for `capture`, and any
       * authorised amount above it is released immediately. Keeping the hold
       * ACTIVE would reserve money that can never be captured again.
       */
      await tx.cardAuthorization.update({
        where: { id: authorization.id },
        data: {
          capturedMinor: nextCaptured,
          status: "CAPTURED",
        },
      });

      const hold = await tx.hold.findUnique({
        where: {
          source_sourceId: {
            source: "CARD_AUTHORIZATION",
            sourceId: input.providerAuthorizationId,
          },
        },
      });

      if (hold) {
        await tx.hold.update({
          where: { id: hold.id },
          data: {
            /*
             * The hold's check constraint caps `capturedMinor` at the
             * authorized amount. The ledger carries the true settlement; the
             * hold is only a reservation and has done its job once released.
             */
            capturedMinor:
              nextCaptured > hold.amountMinor ? hold.amountMinor : nextCaptured,
            status: "CAPTURED",
            capturedAt: new Date(),
            releasedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: auditEntry({
          businessId: input.businessId,
          actorType: "SYSTEM",
          actorId: null,
          action: "CARD_CAPTURED",
          resourceType: "LedgerTransaction",
          resourceId: (posted.transaction as { id: string }).id,
          metadata: {
            cardId: input.cardId,
            authorizationId: authorization.id,
            ...(overCaptured > 0n
              ? { overCapturedMinor: jsonMoney(overCaptured) }
              : {}),
          },
        }),
      });

      return {
        applied: true,
        replayed: posted.replayed,
        capturedMinor: nextCaptured,
      };
    });
  }

  async voidCardAuthorization(input: {
    businessId: string;
    cardId: string;
    providerAuthorizationId: string;
    providerTransactionId: string;
    occurredAt?: Date;
  }): Promise<CardCaptureOutcome> {
    return this.db.$transaction(async (tx) => {
      const authorization = await tx.cardAuthorization.findUnique({
        where: {
          providerAuthorizationId: input.providerAuthorizationId,
        },
      });

      if (!authorization) {
        return {
          applied: false,
          replayed: false,
          reason: "authorization-missing",
        };
      }

      const existing = await tx.cardTransaction.findUnique({
        where: { providerTransactionId: input.providerTransactionId },
      });

      if (existing) {
        return {
          applied: true,
          replayed: true,
          capturedMinor: authorization.capturedMinor,
        };
      }

      const remaining = authorization.amountMinor - authorization.capturedMinor;

      await tx.cardTransaction.create({
        data: {
          businessId: input.businessId,
          accountId: authorization.accountId,
          cardId: input.cardId,
          authorizationId: authorization.id,
          providerTransactionId: input.providerTransactionId,
          kind: "VOID",
          amountMinor: remaining > 0n ? remaining : 0n,
          currency: authorization.currency,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });

      await tx.hold.updateMany({
        where: {
          source: "CARD_AUTHORIZATION",
          sourceId: input.providerAuthorizationId,
          status: "ACTIVE",
        },
        data: { status: "RELEASED", releasedAt: new Date() },
      });

      await tx.cardAuthorization.update({
        where: { id: authorization.id },
        data: {
          status:
            authorization.capturedMinor > 0n
              ? "PARTIALLY_CAPTURED"
              : "REVERSED",
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId: input.businessId,
          actorType: "SYSTEM",
          actorId: null,
          action: "CARD_AUTHORIZATION_VOIDED",
          resourceType: "CardAuthorization",
          resourceId: authorization.id,
          metadata: { cardId: input.cardId },
        }),
      });

      return {
        applied: true,
        replayed: false,
        capturedMinor: authorization.capturedMinor,
      };
    });
  }

  async reverseCardCapture(input: {
    businessId: string;
    cardId: string;
    providerAuthorizationId: string;
    providerTransactionId: string;
    occurredAt?: Date;
  }): Promise<CardCaptureOutcome> {
    return this.db.$transaction(async (tx) => {
      const authorization = await tx.cardAuthorization.findUnique({
        where: {
          providerAuthorizationId: input.providerAuthorizationId,
        },
      });

      if (!authorization) {
        return {
          applied: false,
          replayed: false,
          reason: "authorization-missing",
        };
      }

      const capture = await tx.cardTransaction.findFirst({
        where: { authorizationId: authorization.id, kind: "CAPTURE" },
        orderBy: { occurredAt: "desc" },
      });

      if (!capture) {
        return { applied: false, replayed: false, reason: "capture-missing" };
      }

      const reversalToken = `${capture.providerTransactionId}:reversal`;
      const existing = await tx.cardTransaction.findUnique({
        where: { providerTransactionId: reversalToken },
      });

      if (existing) {
        return {
          applied: true,
          replayed: true,
          capturedMinor: authorization.capturedMinor,
        };
      }

      const original = await tx.ledgerTransaction.findFirst({
        where: {
          businessId: input.businessId,
          sourceType: "LITHIC_CARD_TRANSACTION",
          sourceId: capture.providerTransactionId,
        },
        include: { entries: { include: { ledgerAccount: true } } },
      });

      if (!original) {
        return { applied: false, replayed: false, reason: "ledger-missing" };
      }

      const posted = await this.post(tx, {
        businessId: input.businessId,
        accountId: authorization.accountId,
        currency: authorization.currency,
        kind: "REVERSAL",
        amountMinor: original.amountMinor,
        description: `Reversal · Lithic card purchase${
          authorization.merchantName ? ` · ${authorization.merchantName}` : ""
        }`,
        idempotencyKey: `lithic-reversal:${capture.providerTransactionId}`,
        requestHash: hashRequest({
          token: capture.providerTransactionId,
          kind: "REVERSAL",
        }),
        sourceType: "LITHIC_CARD_REVERSAL",
        sourceId: capture.providerTransactionId,
        occurredAt: input.occurredAt,
        reversesTransactionId: original.id,
        lines: original.entries.map((entry) => ({
          code: (entry.ledgerAccount.code === "1010" ? "1010" : "2010") as
            | "1010"
            | "2010",
          direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
          amountMinor: entry.amountMinor,
        })),
      });

      await tx.ledgerTransaction.update({
        where: { id: original.id },
        data: { status: "REVERSED" },
      });

      await tx.cardTransaction.create({
        data: {
          businessId: input.businessId,
          accountId: authorization.accountId,
          cardId: input.cardId,
          authorizationId: authorization.id,
          providerTransactionId: reversalToken,
          kind: "REVERSAL",
          amountMinor: capture.amountMinor,
          currency: authorization.currency,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });

      const nextCaptured =
        authorization.capturedMinor > capture.amountMinor
          ? authorization.capturedMinor - capture.amountMinor
          : 0n;

      await tx.cardAuthorization.update({
        where: { id: authorization.id },
        data: {
          capturedMinor: nextCaptured,
          status: nextCaptured === 0n ? "REVERSED" : "PARTIALLY_CAPTURED",
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId: input.businessId,
          actorType: "SYSTEM",
          actorId: null,
          action: "CARD_CAPTURE_REVERSED",
          resourceType: "LedgerTransaction",
          resourceId: original.id,
          metadata: {
            cardId: input.cardId,
            authorizationId: authorization.id,
          },
        }),
      });

      return {
        applied: true,
        replayed: posted.replayed,
        capturedMinor: nextCaptured,
      };
    });
  }

  async refundCard(input: {
    businessId: string;
    cardId: string;
    providerAuthorizationId: string;
    providerTransactionId: string;
    amountMinor: bigint;
    occurredAt?: Date;
  }): Promise<CardCaptureOutcome> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.cardTransaction.findUnique({
        where: { providerTransactionId: input.providerTransactionId },
      });

      if (existing) {
        return { applied: true, replayed: true };
      }

      const authorization = await tx.cardAuthorization.findUnique({
        where: {
          providerAuthorizationId: input.providerAuthorizationId,
        },
      });

      if (!authorization) {
        return {
          applied: false,
          replayed: false,
          reason: "authorization-missing",
        };
      }

      const posted = await this.post(tx, {
        businessId: input.businessId,
        accountId: authorization.accountId,
        currency: authorization.currency,
        kind: "CARD_REFUND",
        amountMinor: input.amountMinor,
        description: `Lithic card refund${
          authorization.merchantName ? ` · ${authorization.merchantName}` : ""
        }`,
        idempotencyKey: `lithic-refund:${input.providerTransactionId}`,
        requestHash: hashRequest({
          token: input.providerTransactionId,
          kind: "CARD_REFUND",
        }),
        sourceType: "LITHIC_CARD_REFUND",
        sourceId: input.providerTransactionId,
        occurredAt: input.occurredAt,
        lines: [
          { code: "2010", direction: "CREDIT", amountMinor: input.amountMinor },
          { code: "1010", direction: "DEBIT", amountMinor: input.amountMinor },
        ],
      });

      await tx.cardTransaction.create({
        data: {
          businessId: input.businessId,
          accountId: authorization.accountId,
          cardId: input.cardId,
          authorizationId: authorization.id,
          providerTransactionId: input.providerTransactionId,
          kind: "REFUND",
          amountMinor: input.amountMinor,
          currency: authorization.currency,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId: input.businessId,
          actorType: "SYSTEM",
          actorId: null,
          action: "CARD_REFUNDED",
          resourceType: "LedgerTransaction",
          resourceId: (posted.transaction as { id: string }).id,
          metadata: {
            cardId: input.cardId,
            authorizationId: authorization.id,
          },
        }),
      });

      return { applied: true, replayed: posted.replayed };
    });
  }

  /**
   * Payment primitive used by the maker-checker flow.
   *
   * It runs on the caller's transaction so the approval row, the payment
   * request transition and the ledger posting commit or roll back together.
   * The account row is locked before the available balance is read, which is
   * what stops two approvers from spending the same funds.
   */
  async postPaymentWithin(
    tx: Tx,
    input: {
      businessId: string;
      paymentRequestId: string;
      actorUserId: string;
      amountMinor: bigint;
      beneficiaryName: string;
    },
  ) {
    const business = await tx.business.findUnique({
      where: { id: input.businessId },
      select: { status: true, currency: true },
    });
    if (!business) throw new ApiError(PAYMENT_ERRORS.BUSINESS_NOT_ACTIVE, 409);
    if (business.status !== BUSINESS_STATUS.ACTIVE)
      throw new ApiError(PAYMENT_ERRORS.BUSINESS_NOT_ACTIVE, 409);

    const { account, currency } = await this.account(tx, input.businessId);
    if (account.status !== "ACTIVE")
      throw new ApiError(PAYMENT_ERRORS.ACCOUNT_NOT_ACTIVE, 409);

    const idempotencyKey = `payment:${input.paymentRequestId}`;
    const requestHash = hashRequest({
      paymentRequestId: input.paymentRequestId,
      amountMinor: input.amountMinor.toString(),
      currency,
      beneficiaryName: input.beneficiaryName,
    });

    /*
     * Re-check the idempotency key before the balance check so a replay of an
     * already-posted payment never fails just because the wallet has since
     * spent the money. `post` still validates the request hash.
     */
    const replay = await tx.ledgerTransaction.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: input.businessId,
          idempotencyKey,
        },
      },
      include: {
        entries: { include: { ledgerAccount: true } },
        reversedBy: true,
        reverses: true,
      },
    });

    if (replay) {
      if (replay.requestHash !== requestHash)
        throw new ApiError(LEDGER_ERRORS.IDEMPOTENCY_KEY_REUSED, 409);
      return {
        transaction: mapTransaction(
          replay as unknown as Record<string, unknown>,
        ),
        replayed: true,
        accountId: account.id,
        balance: this.moneyBalance(await this.balance(tx, account.id)),
      };
    }

    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
    const current = await this.balance(tx, account.id);
    if (input.amountMinor > current.availableMinor)
      throw new ApiError(PAYMENT_ERRORS.INSUFFICIENT_FUNDS, 409);

    const posted = await this.post(tx, {
      businessId: input.businessId,
      accountId: account.id,
      currency,
      kind: "PAYMENT",
      amountMinor: input.amountMinor,
      description: `Payment · ${input.beneficiaryName}`.slice(0, 160),
      idempotencyKey,
      requestHash,
      sourceType: "PAYMENT_REQUEST",
      sourceId: input.paymentRequestId,
      actorUserId: input.actorUserId,
      lines: [
        {
          code: "2010",
          direction: "DEBIT",
          amountMinor: input.amountMinor,
        },
        {
          code: "1010",
          direction: "CREDIT",
          amountMinor: input.amountMinor,
        },
      ],
    });

    return {
      ...posted,
      accountId: account.id,
      balance: this.moneyBalance(await this.balance(tx, account.id)),
    };
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
    ensureOperations(role);
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
