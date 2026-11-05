/**
 * Card issuing and card-spend orchestration.
 *
 * Responsibilities are deliberately split:
 *   - `LithicClient` speaks the provider's API.
 *   - `LedgerService` owns holds, captures, refunds and reversals.
 *   - This service owns tenant isolation, role checks, status mapping and the
 *     webhook event log.
 *
 * Lithic is never the book of record. Every money movement created here is a
 * balanced, idempotent ledger transaction; a provider event can only ask the
 * ledger to post one.
 */

import { inject, injectable } from "inversify";
import type { IncomingHttpHeaders } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { TYPES } from "../config/types.js";
import type { DbClient } from "../types/database.types.js";
import type { UserRole } from "../constants/constants.js";
import { BUSINESS_STATUS, USER_ROLE } from "../constants/constants.js";
import { CARD_ERRORS, WEBHOOK_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import { auditEntry } from "../utils/audit.js";
import { env } from "../config/env.js";
import { jsonMoney, parseMinorUnits } from "../utils/money.js";
import LithicClient, {
  LithicSandboxUnavailableError,
  LithicUnavailableError,
} from "../integrations/lithic/lithic.client.js";
import LedgerService from "./ledger.service.js";

type CardStatus = "PENDING" | "ACTIVE" | "INACTIVE" | "CANCELED" | "EXPIRED";

const SPEND_INTERVALS = new Set([
  "ANNUALLY",
  "FOREVER",
  "MONTHLY",
  "TRANSACTION",
]);

function isOperator(role: UserRole) {
  return role === USER_ROLE.OWNER || role === USER_ROLE.ADMIN;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Lithic states are OPEN / PAUSED / CLOSED; NeoBank uses four local states. */
function mapCardState(state: string): CardStatus {
  switch (state.toUpperCase()) {
    case "OPEN":
      return "ACTIVE";
    case "PAUSED":
      return "INACTIVE";
    case "CLOSED":
      return "CANCELED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "PENDING";
  }
}

function mapHolderStatus(status: string) {
  switch (status.toUpperCase()) {
    case "ACCEPTED":
    case "ACTIVE":
      return "ACTIVE" as const;
    case "PENDING":
    case "UNDER_REVIEW":
    case "PENDING_VERIFICATION":
      return "PENDING" as const;
    default:
      return "INACTIVE" as const;
  }
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function amountFrom(...candidates: unknown[]): bigint {
  for (const candidate of candidates) {
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      return BigInt(Math.trunc(candidate));
    }

    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
      const value = BigInt(candidate);
      if (value > 0n) {
        return value;
      }
    }

    if (typeof candidate === "object" && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).amount;

      if (typeof nested === "number" && nested > 0) {
        return BigInt(Math.trunc(nested));
      }

      if (typeof nested === "string" && /^\d+$/.test(nested)) {
        const value = BigInt(nested);
        if (value > 0n) {
          return value;
        }
      }
    }
  }

  return 0n;
}

function containsToken(value: unknown, token: string): boolean {
  if (typeof value === "string") {
    return value === token;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsToken(item, token));
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((item) => containsToken(item, token));
  }

  return false;
}

function safeAmount(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const amount =
    typeof record.amount === "number"
      ? record.amount
      : typeof record.amount === "string" && /^-?\d+$/.test(record.amount)
        ? Number(record.amount)
        : undefined;

  return {
    ...(amount === undefined ? {} : { amount }),
    ...(typeof record.currency === "string"
      ? { currency: record.currency }
      : {}),
  };
}

/**
 * Store only the fields the reconciliation screen needs. In Sandbox a
 * `card.created` payload contains the PAN and CVV; those must never reach the
 * database or a log line.
 */
function sanitiseLithicData(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const clean: Record<string, unknown> = {};

  for (const key of [
    "token",
    "card_token",
    "account_token",
    "status",
    "result",
    "amount",
    "authorization_amount",
    "settled_amount",
    "effective_polarity",
    "type",
    "state",
    "last_four",
    "created",
  ]) {
    if (typeof source[key] === "string" || typeof source[key] === "number") {
      clean[key] = source[key];
    }
  }

  if (typeof source.amounts === "object" && source.amounts !== null) {
    const amounts = source.amounts as Record<string, unknown>;
    clean.amounts = Object.fromEntries(
      ["hold", "cardholder", "merchant", "settlement"]
        .map((key) => [key, safeAmount(amounts[key])])
        .filter(([, value]) => value !== null),
    );
  }

  if (typeof source.merchant === "object" && source.merchant !== null) {
    const merchant = source.merchant as Record<string, unknown>;
    clean.merchant = {
      ...(typeof merchant.descriptor === "string"
        ? { descriptor: merchant.descriptor }
        : {}),
      ...(typeof merchant.mcc === "string" ? { mcc: merchant.mcc } : {}),
      ...(typeof merchant.city === "string" ? { city: merchant.city } : {}),
      ...(typeof merchant.country === "string"
        ? { country: merchant.country }
        : {}),
    };
  }

  if (Array.isArray(source.events)) {
    clean.events = source.events
      .slice(0, 20)
      .map((event) => sanitiseLithicData(event));
  }

  return clean;
}

@injectable()
export default class CardService {
  private readonly lithic = new LithicClient();

  constructor(
    @inject(TYPES.PrismaClient) private readonly db: DbClient,
    @inject(TYPES.LedgerService) private readonly ledger: LedgerService,
  ) {}

  private ensureRole(role: UserRole, operatorOnly = false) {
    if (operatorOnly ? !isOperator(role) : role === USER_ROLE.OPERATIONS) {
      throw new ApiError("You are not allowed to access cards", 403);
    }
  }

  private ensureSandbox() {
    if (!env.lithic.enabled || !env.lithic.apiKey) {
      throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
    }

    if (env.lithic.environment !== "sandbox") {
      throw new ApiError(CARD_ERRORS.SANDBOX_ONLY, 403);
    }

    if (!env.lithic.webhookSecret) {
      throw new ApiError(
        "LITHIC_WEBHOOK_SECRET is required to sign sandbox events",
        503,
      );
    }
  }

  private async business(businessId: string) {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
    });

    if (!business || business.status !== BUSINESS_STATUS.ACTIVE) {
      throw new ApiError(CARD_ERRORS.BUSINESS_NOT_ACTIVE, 409);
    }

    return business;
  }

  private view(row: any) {
    return {
      id: row.id,
      provider: row.provider,
      providerCardId: row.providerCardId,
      providerCardholderId: row.cardholder?.providerCardholderId ?? null,
      status: row.status,
      type: row.type,
      currency: row.currency,
      last4: row.last4,
      brand: row.brand,
      expMonth: row.expMonth,
      expYear: row.expYear,
      spendingLimitMinor:
        row.spendingLimitMinor == null
          ? null
          : jsonMoney(row.spendingLimitMinor),
      spendingLimitInterval: row.spendingLimitInterval,
      cardholderStatus: row.cardholder?.status ?? null,
      employee: row.cardholder?.user
        ? {
            id: row.cardholder.user.id,
            email: row.cardholder.user.email,
            username: row.cardholder.user.username,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private viewAuthorization(row: any) {
    return {
      id: row.id,
      providerAuthorizationId: row.providerAuthorizationId,
      amountMinor: jsonMoney(row.amountMinor),
      capturedMinor: jsonMoney(row.capturedMinor),
      currency: row.currency,
      status: row.status,
      merchantName: row.merchantName,
      merchantMcc: row.merchantMcc,
      providerCreatedAt: row.providerCreatedAt,
      createdAt: row.createdAt,
      transactions: (row.transactions ?? []).map((transaction: any) => ({
        id: transaction.id,
        providerTransactionId: transaction.providerTransactionId,
        kind: transaction.kind,
        amountMinor: jsonMoney(transaction.amountMinor),
        currency: transaction.currency,
        occurredAt: transaction.occurredAt,
      })),
    };
  }

  async list(businessId: string, userId: string, role: UserRole) {
    await this.business(businessId);
    this.ensureRole(role);

    const rows = await this.db.card.findMany({
      where: isOperator(role)
        ? { businessId }
        : { businessId, cardholder: { userId } },
      include: { cardholder: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
    });

    return { cards: rows.map((row) => this.view(row)) };
  }

  /** The employee-facing read: only the caller's own card and activity. */
  async mine(businessId: string, userId: string, role: UserRole) {
    await this.business(businessId);
    this.ensureRole(role);

    const cards = await this.db.card.findMany({
      where: { businessId, cardholder: { userId } },
      include: { cardholder: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
    });

    const cardIds = cards.map((card) => card.id);
    const authorizations =
      cardIds.length === 0
        ? []
        : await this.db.cardAuthorization.findMany({
            where: { businessId, cardId: { in: cardIds } },
            include: { transactions: true },
            orderBy: { createdAt: "desc" },
          });

    return {
      cards: cards.map((row) => this.view(row)),
      authorizations: authorizations.map((row) => this.viewAuthorization(row)),
    };
  }

  async eligibleEmployees(businessId: string, role: UserRole) {
    await this.business(businessId);
    this.ensureRole(role, true);

    const rows = await this.db.businessMember.findMany({
      where: { businessId, status: "ACTIVE", role: "EMPLOYEE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });

    return {
      employees: rows.map((row) => ({
        id: row.user.id,
        email: row.user.email,
        username: row.user.username,
      })),
    };
  }

  async get(businessId: string, userId: string, role: UserRole, id: string) {
    await this.business(businessId);
    this.ensureRole(role);

    const row = await this.db.card.findFirst({
      where: {
        id,
        businessId,
        ...(isOperator(role) ? {} : { cardholder: { userId } }),
      },
      include: { cardholder: { include: { user: true } } },
    });

    if (!row) {
      throw new ApiError(CARD_ERRORS.CARD_NOT_FOUND, 404);
    }

    return { card: this.view(row) };
  }

  async createCardholder(businessId: string, role: UserRole, userId: string) {
    const business = await this.business(businessId);
    this.ensureRole(role, true);

    const member = await this.db.businessMember.findFirst({
      where: {
        businessId,
        userId,
        status: "ACTIVE",
        role: "EMPLOYEE",
      },
      include: { user: true },
    });

    if (!member) {
      throw new ApiError(CARD_ERRORS.EMPLOYEE_REQUIRED, 422);
    }

    const existing = await this.db.cardholder.findUnique({
      where: {
        businessId_userId_provider: {
          businessId,
          userId,
          provider: "LITHIC",
        },
      },
    });

    if (existing) {
      return {
        cardholder: {
          id: existing.id,
          providerId: existing.providerCardholderId,
          accountId: existing.providerAccountId,
          status: existing.status,
        },
        replayed: true,
      };
    }

    const parts = member.user.username.trim().split(/\s+/);
    const firstName = parts[0] || "Employee";
    const lastName = parts.slice(1).join(" ") || "User";

    let provider;

    try {
      provider = await this.lithic.createAccountHolder({
        email: member.user.email,
        firstName,
        lastName,
        /*
         * Lithic requires a phone for an AUTHORIZED_USER exemption. NeoBank
         * does not collect one yet, so Sandbox uses a documented synthetic
         * number; production must collect the employee's own number first.
         */
        phoneNumber:
          business.phone && business.phone.startsWith("+")
            ? business.phone
            : "+15555550100",
        address: {
          address1: business.addressLine1 || "1 Main Street",
          city: business.city || "New York",
          state: business.state || "NY",
          postalCode: business.postalCode || "10001",
          country:
            (business.country || "US").toUpperCase() === "US"
              ? "USA"
              : business.country || "USA",
        },
      });
    } catch (error) {
      if (error instanceof LithicUnavailableError) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw new ApiError(
        `Lithic rejected the account holder request: ${
          error instanceof Error ? error.message.slice(0, 160) : "unknown"
        }`,
        502,
      );
    }

    if (!provider.token) {
      throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 502);
    }

    const row = await this.db.cardholder.create({
      data: {
        businessId,
        userId,
        provider: "LITHIC",
        providerCardholderId: provider.token,
        providerAccountId: provider.account_token ?? null,
        status: mapHolderStatus(provider.status ?? "PENDING"),
      },
    });

    await this.db.auditLog.create({
      data: auditEntry({
        businessId,
        actorType: "SYSTEM",
        actorId: null,
        action: "CARDHOLDER_CREATED",
        resourceType: "Cardholder",
        resourceId: row.id,
        metadata: { userId },
      }),
    });

    return {
      cardholder: {
        id: row.id,
        providerId: row.providerCardholderId,
        accountId: row.providerAccountId,
        status: row.status,
      },
      replayed: false,
    };
  }

  async issue(
    businessId: string,
    role: UserRole,
    actorUserId: string,
    input: {
      userId?: unknown;
      spendingLimitMinor?: unknown;
      spendingLimitInterval?: unknown;
    },
  ) {
    const business = await this.business(businessId);
    this.ensureRole(role, true);

    const userId = asString(input.userId);

    if (!userId) {
      throw new ApiError(CARD_ERRORS.EMPLOYEE_REQUIRED, 422);
    }

    const limit =
      input.spendingLimitMinor == null
        ? undefined
        : parseMinorUnits(input.spendingLimitMinor);

    if (limit !== undefined && limit <= 0n) {
      throw new ApiError(CARD_ERRORS.INVALID_LIMIT, 422);
    }

    if (limit !== undefined && limit > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ApiError(CARD_ERRORS.INVALID_LIMIT, 422);
    }

    const interval = asString(input.spendingLimitInterval) || "MONTHLY";

    if (limit !== undefined && !SPEND_INTERVALS.has(interval)) {
      throw new ApiError(CARD_ERRORS.INVALID_INTERVAL, 422);
    }

    const holderResult = await this.createCardholder(businessId, role, userId);
    const holder = await this.db.cardholder.findUniqueOrThrow({
      where: { id: holderResult.cardholder.id },
    });

    if (!holder.providerAccountId) {
      throw new ApiError(CARD_ERRORS.CARDHOLDER_ACCOUNT_MISSING, 409);
    }

    const existing = await this.db.card.findFirst({
      where: {
        businessId,
        cardholderId: holder.id,
        status: { not: "CANCELED" },
      },
      include: { cardholder: { include: { user: true } } },
    });

    if (existing) {
      return { card: this.view(existing), replayed: true };
    }

    let provider;

    try {
      provider = await this.lithic.createVirtualCard({
        accountToken: holder.providerAccountId,
        spendLimit: limit === undefined ? undefined : Number(limit),
        spendLimitDuration: limit === undefined ? undefined : interval,
        memo: `NeoBank ${business.legalName}`.slice(0, 64),
      });
    } catch (error) {
      if (error instanceof LithicUnavailableError) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw new ApiError(
        `Lithic rejected the card request: ${
          error instanceof Error ? error.message.slice(0, 160) : "unknown"
        }`,
        502,
      );
    }

    const row = await this.db.card.create({
      data: {
        businessId,
        cardholderId: holder.id,
        provider: "LITHIC",
        providerCardId: provider.token,
        type: "VIRTUAL",
        status: mapCardState(provider.state ?? "OPEN"),
        currency: business.currency,
        last4: provider.last_four?.slice(-4) ?? null,
        brand: null,
        expMonth:
          provider.exp_month == null ? null : Number(provider.exp_month),
        expYear: provider.exp_year == null ? null : Number(provider.exp_year),
        spendingLimitMinor: limit ?? null,
        spendingLimitInterval: limit === undefined ? null : interval,
      },
      include: { cardholder: { include: { user: true } } },
    });

    await this.db.auditLog.create({
      data: auditEntry({
        businessId,
        actorType: "USER",
        actorId: actorUserId,
        action: "CARD_ISSUED",
        resourceType: "Card",
        resourceId: row.id,
        metadata: { userId, provider: "LITHIC" },
      }),
    });

    return { card: this.view(row), replayed: false };
  }

  async updateStatus(
    businessId: string,
    userId: string,
    role: UserRole,
    id: string,
    status: "ACTIVE" | "PAUSED" | "CANCELED",
  ) {
    await this.business(businessId);
    this.ensureRole(role, status !== "PAUSED");

    const row = await this.db.card.findFirst({
      where: {
        id,
        businessId,
        ...(status === "PAUSED" && !isOperator(role)
          ? { cardholder: { userId } }
          : {}),
      },
      include: { cardholder: { include: { user: true } } },
    });

    if (!row) {
      throw new ApiError(CARD_ERRORS.CARD_NOT_FOUND, 404);
    }

    if (row.status === "CANCELED" && status !== "CANCELED") {
      throw new ApiError(CARD_ERRORS.CARD_NOT_ACTIVE, 409);
    }

    const providerState =
      status === "ACTIVE" ? "OPEN" : status === "PAUSED" ? "PAUSED" : "CLOSED";

    let provider;

    try {
      provider = await this.lithic.updateCard(
        row.providerCardId,
        providerState,
      );
    } catch (error) {
      if (error instanceof LithicUnavailableError) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw error;
    }

    const updated = await this.db.card.update({
      where: { id: row.id },
      data: { status: mapCardState(provider.state ?? providerState) },
      include: { cardholder: { include: { user: true } } },
    });

    await this.db.auditLog.create({
      data: auditEntry({
        businessId,
        actorType: "USER",
        actorId: userId,
        action: "CARD_STATUS_CHANGED",
        resourceType: "Card",
        resourceId: row.id,
        metadata: { status: updated.status },
      }),
    });

    return {
      card: this.view(updated),
      providerState: provider.state ?? providerState,
    };
  }

  async authorizations(
    businessId: string,
    userId: string,
    role: UserRole,
    cardId: string,
  ) {
    await this.business(businessId);
    this.ensureRole(role);

    const rows = await this.db.cardAuthorization.findMany({
      where: {
        businessId,
        cardId,
        ...(isOperator(role) ? {} : { card: { cardholder: { userId } } }),
      },
      include: { transactions: true },
      orderBy: { createdAt: "desc" },
    });

    return { authorizations: rows.map((row) => this.viewAuthorization(row)) };
  }

  /* ----------------------------------------------------------------------- *
   * Webhook ingestion
   * ----------------------------------------------------------------------- */

  private secretKey(secret: string) {
    return secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret, "utf8");
  }

  private signature(raw: Buffer, headers: IncomingHttpHeaders) {
    if (!env.lithic.webhookSecret) {
      throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
    }

    const get = (name: string) => {
      const value = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };
    const id = get("webhook-id");
    const timestamp = get("webhook-timestamp");
    const signatures = get("webhook-signature");

    if (!id || !timestamp || !signatures) {
      throw new ApiError(WEBHOOK_ERRORS.INVALID_SIGNATURE, 401);
    }

    const seconds = Number(timestamp);

    if (
      !Number.isFinite(seconds) ||
      Math.abs(Date.now() / 1000 - seconds) > env.lithic.webhookToleranceSeconds
    ) {
      throw new ApiError(WEBHOOK_ERRORS.STALE_TIMESTAMP, 401);
    }

    const expected = createHmac(
      "sha256",
      this.secretKey(env.lithic.webhookSecret),
    )
      .update(`${id}.${timestamp}.${raw.toString("utf8")}`)
      .digest();

    const valid = String(signatures)
      .split(" ")
      .some((item) => {
        const [version, encoded] = item.split(",");

        if (version !== "v1" || !encoded) {
          return false;
        }

        try {
          const actual = Buffer.from(encoded, "base64");
          return (
            actual.length === expected.length &&
            timingSafeEqual(actual, expected)
          );
        } catch {
          return false;
        }
      });

    if (!valid) {
      throw new ApiError(WEBHOOK_ERRORS.INVALID_SIGNATURE, 401);
    }

    return { id, timestamp: new Date(seconds * 1000) };
  }

  async handleWebhook(raw: Buffer, headers: IncomingHttpHeaders) {
    const verified = this.signature(raw, headers);
    let envelope: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(raw.toString("utf8"));

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("not an object");
      }

      envelope = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(WEBHOOK_ERRORS.MALFORMED_PAYLOAD, 400);
    }

    const eventType = asString(envelope.event_type);
    const data = sanitiseLithicData(
      envelope.payload ?? envelope.data ?? envelope,
    );

    if (!eventType) {
      throw new ApiError(WEBHOOK_ERRORS.MALFORMED_PAYLOAD, 400);
    }

    const providerEventId = asString(envelope.token) || verified.id;
    const providerCreatedAt = parseDate(envelope.created) ?? verified.timestamp;

    const cardToken =
      asString(data.card_token) ||
      (eventType.startsWith("card.") ? asString(data.token) : "");
    const accountToken = asString(data.account_token);

    const card = cardToken
      ? await this.db.card.findUnique({
          where: { providerCardId: cardToken },
          select: { businessId: true },
        })
      : null;
    const holder =
      !card && accountToken
        ? await this.db.cardholder.findFirst({
            where: { providerAccountId: accountToken },
            select: { businessId: true },
          })
        : null;
    const businessId = card?.businessId ?? holder?.businessId ?? null;

    try {
      await this.db.webhookEvent.create({
        data: {
          provider: "LITHIC",
          providerEventId,
          eventType,
          businessId,
          resourceId: asString(data.token) || null,
          payload: data as object,
          providerCreatedAt,
          signatureVerified: true,
          status: "RECEIVED",
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return "duplicate" as const;
      }

      throw error;
    }

    try {
      const outcome = await this.applyEvent(data, eventType);

      if (outcome === "parked") {
        await this.db.webhookEvent.update({
          where: {
            provider_providerEventId: {
              provider: "LITHIC",
              providerEventId,
            },
          },
          data: {
            lastError: "Waiting for the matching authorization event",
          },
        });

        return "ignored" as const;
      }

      await this.db.webhookEvent.update({
        where: {
          provider_providerEventId: {
            provider: "LITHIC",
            providerEventId,
          },
        },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
      });

      if (outcome === "processed" && cardToken) {
        await this.drainParked(cardToken, asString(data.token));
      }

      return outcome === "processed"
        ? ("processed" as const)
        : ("ignored" as const);
    } catch (error) {
      await this.db.webhookEvent.update({
        where: {
          provider_providerEventId: { provider: "LITHIC", providerEventId },
        },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }

  private eventList(data: Record<string, unknown>) {
    return Array.isArray(data.events) && data.events.length > 0
      ? (data.events as Array<Record<string, unknown>>)
      : [data];
  }

  private merchant(data: Record<string, unknown>) {
    const merchant =
      typeof data.merchant === "object" && data.merchant !== null
        ? (data.merchant as Record<string, unknown>)
        : {};

    return {
      merchantName:
        asString(merchant.descriptor) || asString(data.merchant_name) || null,
      merchantMcc:
        asString(merchant.mcc) || asString(data.merchant_mcc) || null,
    };
  }

  private async applyEvent(
    data: Record<string, unknown>,
    eventType: string,
  ): Promise<"processed" | "parked" | "ignored"> {
    if (eventType.startsWith("card.")) {
      const token = asString(data.token);
      const state = asString(data.state);

      if (!token) {
        return "ignored";
      }

      const card = await this.db.card.findUnique({
        where: { providerCardId: token },
      });

      if (!card) {
        return "ignored";
      }

      const next = mapCardState(state);

      if (next !== card.status) {
        await this.db.card.update({
          where: { id: card.id },
          data: { status: next },
        });
      }

      return "processed";
    }

    if (
      eventType !== "card_transaction.updated" &&
      eventType !== "card_transaction.created"
    ) {
      return "ignored";
    }

    const cardToken = asString(data.card_token);
    const authorizationToken = asString(data.token);

    if (!cardToken || !authorizationToken) {
      return "ignored";
    }

    const card = await this.db.card.findUnique({
      where: { providerCardId: cardToken },
    });

    if (!card) {
      return "ignored";
    }

    const { merchantName, merchantMcc } = this.merchant(data);
    const providerCreatedAt = parseDate(data.created) ?? new Date();
    const fallbackAmount = amountFrom(
      data.settled_amount,
      data.authorization_amount,
      data.amount,
      data.amounts,
    );

    let sawProcessed = false;

    for (const event of this.eventList(data)) {
      const type = asString(event.type).toUpperCase();
      const result = asString(event.result).toUpperCase();
      const amount =
        amountFrom(event.amount, event.amounts, fallbackAmount) ||
        fallbackAmount;
      const occurredAt = parseDate(event.created) ?? providerCreatedAt;

      if (type === "AUTHORIZATION") {
        const outcome = await this.ledger.authorizeCard({
          businessId: card.businessId,
          cardId: card.id,
          providerAuthorizationId: authorizationToken,
          amountMinor: amount,
          cardActive: card.status === "ACTIVE",
          declined: result === "DECLINED",
          merchantName,
          merchantMcc,
          providerCreatedAt,
        });

        if (!outcome.recorded) {
          return outcome.reason === "account-missing" ? "parked" : "ignored";
        }

        sawProcessed = true;
        continue;
      }

      if (type === "CLEARING") {
        const outcome = await this.ledger.captureCard({
          businessId: card.businessId,
          cardId: card.id,
          providerAuthorizationId: authorizationToken,
          providerTransactionId: authorizationToken,
          amountMinor: amount,
          occurredAt,
        });

        if (!outcome.applied) {
          if (outcome.reason === "authorization-missing") {
            return "parked";
          }

          continue;
        }

        sawProcessed = true;
        continue;
      }

      if (
        type === "VOID" ||
        type === "AUTHORIZATION_REVERSAL" ||
        type === "AUTH_EXPIRY" ||
        type === "AUTHORIZATION_EXPIRY"
      ) {
        const outcome = await this.ledger.voidCardAuthorization({
          businessId: card.businessId,
          cardId: card.id,
          providerAuthorizationId: authorizationToken,
          providerTransactionId: `${authorizationToken}:void:${type.toLowerCase()}`,
          occurredAt,
        });

        if (!outcome.applied) {
          if (outcome.reason === "authorization-missing") {
            return "parked";
          }

          continue;
        }

        sawProcessed = true;
        continue;
      }

      if (type === "REVERSAL") {
        const outcome = await this.ledger.reverseCardCapture({
          businessId: card.businessId,
          cardId: card.id,
          providerAuthorizationId: authorizationToken,
          providerTransactionId: authorizationToken,
          occurredAt,
        });

        if (!outcome.applied) {
          if (
            outcome.reason === "authorization-missing" ||
            outcome.reason === "capture-missing"
          ) {
            return "parked";
          }

          continue;
        }

        sawProcessed = true;
        continue;
      }

      if (type === "REFUND") {
        const outcome = await this.ledger.refundCard({
          businessId: card.businessId,
          cardId: card.id,
          providerAuthorizationId: authorizationToken,
          providerTransactionId: `${authorizationToken}:refund:${asString(event.token) || occurredAt.getTime()}`,
          amountMinor: amount,
          occurredAt,
        });

        if (!outcome.applied) {
          if (outcome.reason === "authorization-missing") {
            return "parked";
          }

          continue;
        }

        sawProcessed = true;
      }
    }

    // A status transition without an event array (for example VOIDED/SETTLED)
    // still needs to reach the ledger.
    if (!sawProcessed && this.eventList(data).length === 1) {
      const status = asString(data.status).toUpperCase();

      if (status === "VOIDED") {
        return (
          await this.ledger.voidCardAuthorization({
            businessId: card.businessId,
            cardId: card.id,
            providerAuthorizationId: authorizationToken,
            providerTransactionId: `${authorizationToken}:void:status`,
            occurredAt: providerCreatedAt,
          })
        ).applied
          ? "processed"
          : "parked";
      }

      if (status === "SETTLED" && fallbackAmount > 0n) {
        return (
          await this.ledger.captureCard({
            businessId: card.businessId,
            cardId: card.id,
            providerAuthorizationId: authorizationToken,
            providerTransactionId: authorizationToken,
            amountMinor: fallbackAmount,
            occurredAt: providerCreatedAt,
          })
        ).applied
          ? "processed"
          : "parked";
      }
    }

    return sawProcessed ? "processed" : "ignored";
  }

  private async drainParked(cardToken: string, authorizationToken: string) {
    const parked = await this.db.webhookEvent.findMany({
      where: { provider: "LITHIC", status: "RECEIVED" },
      take: 100,
      orderBy: { receivedAt: "asc" },
    });

    for (const event of parked) {
      if (
        !containsToken(event.payload, cardToken) &&
        !containsToken(event.payload, authorizationToken)
      ) {
        continue;
      }

      const outcome = await this.applyEvent(
        event.payload as Record<string, unknown>,
        event.eventType,
      );

      if (outcome !== "parked") {
        await this.db.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            lastError: null,
          },
        });
      }
    }
  }

  /* ----------------------------------------------------------------------- *
   * Sandbox drivers
   *
   * These call Lithic's Sandbox simulator, then feed a signed webhook through
   * the exact production ingress path. They are operator-only, refused outside
   * Sandbox, and labelled as simulations in the UI.
   * ----------------------------------------------------------------------- */

  private async deliverSandboxEvent(envelope: Record<string, unknown>) {
    const body = JSON.stringify(envelope);
    const eventId = asString(envelope.token);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac(
      "sha256",
      this.secretKey(env.lithic.webhookSecret),
    )
      .update(`${eventId}.${timestamp}.${body}`)
      .digest("base64");

    return this.handleWebhook(Buffer.from(body, "utf8"), {
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    });
  }

  private existingSandboxEvent(eventId: string) {
    return this.db.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: "LITHIC",
          providerEventId: eventId,
        },
      },
    });
  }

  async simulateAuthorization(
    businessId: string,
    role: UserRole,
    cardId: string,
    input: { amountMinor?: unknown; descriptor?: unknown; eventId?: unknown },
  ) {
    this.ensureSandbox();
    await this.business(businessId);
    this.ensureRole(role, true);

    const card = await this.db.card.findFirst({
      where: { id: cardId, businessId },
    });

    if (!card) {
      throw new ApiError(CARD_ERRORS.CARD_NOT_FOUND, 404);
    }

    const amount = parseMinorUnits(input.amountMinor);

    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ApiError(CARD_ERRORS.INVALID_LIMIT, 422);
    }

    const eventId = asString(input.eventId) || `msg_sim_${randomUUID()}`;
    const replayed = await this.existingSandboxEvent(eventId);

    if (replayed) {
      return {
        outcome:
          replayed.status === "PROCESSED"
            ? ("duplicate" as const)
            : ("ignored" as const),
        eventId,
        transactionToken: asString(
          (replayed.payload as Record<string, unknown> | null)?.token,
        ),
        amountMinor: jsonMoney(amount),
        simulated: true as const,
      };
    }

    let providerCard;

    try {
      providerCard = await this.lithic.retrieveCard(card.providerCardId);
    } catch (error) {
      if (error instanceof LithicUnavailableError) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw error;
    }

    if (!providerCard.pan) {
      throw new ApiError(
        "Lithic Sandbox did not return a PAN for this card",
        502,
      );
    }

    const descriptor = asString(input.descriptor) || "NEOBANK SANDBOX";
    let simulated;

    try {
      simulated = await this.lithic.simulateAuthorization({
        amount: Number(amount),
        descriptor,
        pan: providerCard.pan,
      });
    } catch (error) {
      if (
        error instanceof LithicUnavailableError ||
        error instanceof LithicSandboxUnavailableError
      ) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw error;
    }

    const createdAt = new Date().toISOString();
    const currency = card.currency;
    const amountNumber = Number(amount);
    const eventToken = `evt_sim_${randomUUID()}`;

    const outcome = await this.deliverSandboxEvent({
      token: eventId,
      event_type: "card_transaction.updated",
      created: createdAt,
      payload: {
        token: simulated.token,
        card_token: card.providerCardId,
        account_token: providerCard.account_token ?? null,
        status: "PENDING",
        result: "APPROVED",
        amount: amountNumber,
        authorization_amount: amountNumber,
        amounts: {
          hold: { amount: amountNumber, currency },
          cardholder: { amount: amountNumber, currency },
          merchant: { amount: amountNumber, currency },
          settlement: { amount: 0, currency },
        },
        merchant: {
          descriptor,
          mcc: "5734",
          city: "San Francisco",
          country: "USA",
        },
        events: [
          {
            token: eventToken,
            type: "AUTHORIZATION",
            result: "APPROVED",
            amount: amountNumber,
            effective_polarity: "DEBIT",
            created: createdAt,
            amounts: {
              hold: { amount: amountNumber, currency },
              cardholder: { amount: amountNumber, currency },
              merchant: { amount: amountNumber, currency },
            },
          },
        ],
      },
    });

    return {
      outcome,
      eventId,
      transactionToken: simulated.token,
      amountMinor: jsonMoney(amount),
      simulated: true,
    };
  }

  async simulateClearing(
    businessId: string,
    role: UserRole,
    cardId: string,
    input: {
      transactionToken?: unknown;
      amountMinor?: unknown;
      eventId?: unknown;
    },
  ) {
    this.ensureSandbox();
    await this.business(businessId);
    this.ensureRole(role, true);

    const card = await this.db.card.findFirst({
      where: { id: cardId, businessId },
    });

    if (!card) {
      throw new ApiError(CARD_ERRORS.CARD_NOT_FOUND, 404);
    }

    const transactionToken = asString(input.transactionToken);

    if (!transactionToken) {
      throw new ApiError("transactionToken is required", 422);
    }

    const amount = parseMinorUnits(input.amountMinor);

    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ApiError(CARD_ERRORS.INVALID_LIMIT, 422);
    }

    const eventId = asString(input.eventId) || `msg_sim_${randomUUID()}`;
    const replayed = await this.existingSandboxEvent(eventId);

    if (replayed) {
      return {
        outcome:
          replayed.status === "PROCESSED"
            ? ("duplicate" as const)
            : ("ignored" as const),
        eventId,
        transactionToken,
        amountMinor: jsonMoney(amount),
        simulated: true as const,
      };
    }

    /*
     * The Lithic simulator is not idempotent: calling clearing twice settles
     * the provider transaction twice. A local CAPTURED authorization means the
     * provider call has already happened, so never repeat it.
     */
    const authorization = await this.db.cardAuthorization.findUnique({
      where: { providerAuthorizationId: transactionToken },
    });

    if (authorization?.status === "CAPTURED") {
      return {
        outcome: "duplicate" as const,
        eventId,
        transactionToken,
        amountMinor: jsonMoney(amount),
        simulated: true as const,
      };
    }

    try {
      await this.lithic.simulateClearing({
        amount: Number(amount),
        token: transactionToken,
      });
    } catch (error) {
      if (
        error instanceof LithicUnavailableError ||
        error instanceof LithicSandboxUnavailableError
      ) {
        throw new ApiError(CARD_ERRORS.PROVIDER_UNAVAILABLE, 503);
      }

      throw error;
    }

    const createdAt = new Date().toISOString();
    const amountNumber = Number(amount);

    const outcome = await this.deliverSandboxEvent({
      token: eventId,
      event_type: "card_transaction.updated",
      created: createdAt,
      payload: {
        token: transactionToken,
        card_token: card.providerCardId,
        status: "SETTLED",
        result: "APPROVED",
        amount: amountNumber,
        authorization_amount: amountNumber,
        settled_amount: amountNumber,
        amounts: {
          hold: { amount: 0, currency: card.currency },
          settlement: { amount: -amountNumber, currency: card.currency },
          cardholder: { amount: -amountNumber, currency: card.currency },
          merchant: { amount: -amountNumber, currency: card.currency },
        },
        events: [
          {
            token: `evt_sim_${randomUUID()}`,
            type: "CLEARING",
            result: "APPROVED",
            amount: amountNumber,
            effective_polarity: "DEBIT",
            created: createdAt,
            amounts: {
              settlement: { amount: amountNumber, currency: card.currency },
              cardholder: { amount: amountNumber, currency: card.currency },
              merchant: { amount: amountNumber, currency: card.currency },
            },
          },
        ],
      },
    });

    return {
      outcome,
      eventId,
      transactionToken,
      amountMinor: jsonMoney(amount),
      simulated: true,
    };
  }

  async simulateVoid(
    businessId: string,
    role: UserRole,
    cardId: string,
    input: { transactionToken?: unknown; eventId?: unknown },
  ) {
    this.ensureSandbox();
    await this.business(businessId);
    this.ensureRole(role, true);

    const card = await this.db.card.findFirst({
      where: { id: cardId, businessId },
    });

    if (!card) {
      throw new ApiError(CARD_ERRORS.CARD_NOT_FOUND, 404);
    }

    const transactionToken = asString(input.transactionToken);

    if (!transactionToken) {
      throw new ApiError("transactionToken is required", 422);
    }

    const createdAt = new Date().toISOString();
    const eventId = asString(input.eventId) || `msg_sim_${randomUUID()}`;

    const outcome = await this.deliverSandboxEvent({
      token: eventId,
      event_type: "card_transaction.updated",
      created: createdAt,
      payload: {
        token: transactionToken,
        card_token: card.providerCardId,
        status: "VOIDED",
        result: "APPROVED",
        amount: 0,
        events: [
          {
            token: `evt_sim_${randomUUID()}`,
            type: "VOID",
            result: "APPROVED",
            amount: 0,
            created: createdAt,
          },
        ],
      },
    });

    return { outcome, eventId, transactionToken, simulated: true };
  }
}
