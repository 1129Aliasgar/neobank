/**
 * Payment requests and maker-checker approval.
 *
 * Creation decides the policy outcome and snapshots the threshold. Approval is
 * a human decision made in one serialised transaction: the request row is
 * locked, self-approval is refused in the service, the ledger primitive posts
 * exactly one `PAYMENT` transaction, and the request transitions to COMPLETED.
 *
 * The payment rail is a labelled simulator. This service never calls a bank.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { randomUUID } from "node:crypto";
import { TYPES } from "../config/types.js";
import type { DbClient } from "../types/database.types.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  APPROVER_ROLES,
  AUDIT_ACTION,
  BUSINESS_ROLES,
  BUSINESS_STATUS,
  MEMBERSHIP_STATUS,
  PAYMENT_REQUEST_STATUS,
  STATUS_CODE,
  USER_ROLE,
  type UserRole,
} from "../constants/constants.js";
import { PAYMENT_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import { auditEntry } from "../utils/audit.js";
import { decodeCursor, encodeCursor, jsonMoney } from "../utils/money.js";
import { isUniqueConstraintViolation } from "../utils/prismaError.js";
import LedgerService from "./ledger.service.js";

type Tx = Prisma.TransactionClient;

const MAX_AMOUNT_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

const REQUEST_INCLUDE = {
  createdBy: { select: { id: true, username: true, email: true } },
  decisionBy: { select: { id: true, username: true, email: true } },
  approvals: {
    orderBy: { createdAt: "asc" },
    include: {
      actor: { select: { id: true, username: true, email: true } },
    },
  },
  ledgerTransaction: {
    include: {
      entries: { include: { ledgerAccount: true } },
    },
  },
} satisfies Prisma.PaymentRequestInclude;

type PaymentRow = Prisma.PaymentRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

type Viewer = { userId: string; role: UserRole };

type CreatePaymentInput = {
  beneficiaryName: string;
  beneficiaryReference?: string;
  amountMinor: string;
  memo?: string;
};

type ListQuery = {
  status?: string;
  limit?: number;
  cursor?: string;
};

function assertBusinessRole(role: UserRole) {
  if (!BUSINESS_ROLES.includes(role))
    throw new ApiError(PAYMENT_ERRORS.APPROVER_ROLE_REQUIRED, 403);
}

function assertApprover(role: UserRole) {
  if (!APPROVER_ROLES.includes(role))
    throw new ApiError(PAYMENT_ERRORS.APPROVER_ROLE_REQUIRED, 403);
}

function parseAmount(input: string): bigint {
  if (!/^\d{1,15}$/.test(input))
    throw new ApiError(PAYMENT_ERRORS.AMOUNT_INVALID, 422);
  const amount = BigInt(input);
  if (amount <= 0n) throw new ApiError(PAYMENT_ERRORS.AMOUNT_INVALID, 422);
  if (amount > MAX_AMOUNT_MINOR)
    throw new ApiError(PAYMENT_ERRORS.AMOUNT_TOO_LARGE, 422);
  return amount;
}

function trimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

@injectable()
export default class PaymentService {
  @inject(TYPES.LedgerService)
  private readonly ledger!: LedgerService;

  constructor(@inject(TYPES.PrismaClient) private readonly db: DbClient) {}

  private ledgerView(
    row: PaymentRow["ledgerTransaction"],
  ): Record<string, unknown> | null {
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      amountMinor: jsonMoney(row.amountMinor),
      currency: row.currency,
      description: row.description,
      occurredAt: row.occurredAt,
      postedAt: row.postedAt,
      source: { type: row.sourceType, id: row.sourceId },
      lines: row.entries.map((entry) => ({
        accountCode: entry.ledgerAccount.code,
        accountName: entry.ledgerAccount.name,
        direction: entry.direction,
        amountMinor: jsonMoney(entry.amountMinor),
      })),
    };
  }

  private view(row: PaymentRow, viewer: Viewer) {
    const isCreator = row.createdByUserId === viewer.userId;
    return {
      id: row.id,
      businessId: row.businessId,
      status: row.status,
      amountMinor: jsonMoney(row.amountMinor),
      currency: row.currency,
      beneficiaryName: row.beneficiaryName,
      beneficiaryReference: row.beneficiaryReference,
      memo: row.memo,
      createdByUserId: row.createdByUserId,
      createdBy: row.createdBy,
      isCreator,
      decisionByUserId: row.decisionByUserId,
      decisionBy: row.decisionBy,
      decidedAt: row.decidedAt,
      approvalThresholdMinor: jsonMoney(row.approvalThresholdMinor),
      requiredApprovals: row.requiredApprovals,
      approvalsCount: row.approvalsCount,
      ledgerTransactionId: row.ledgerTransactionId,
      ledgerTransaction: this.ledgerView(row.ledgerTransaction),
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvals: row.approvals.map((approval) => ({
        id: approval.id,
        actorUserId: approval.actorUserId,
        actorRole: approval.actorRole,
        decision: approval.decision,
        reason: approval.reason,
        createdAt: approval.createdAt,
        actor: approval.actor,
      })),
      canApprove:
        APPROVER_ROLES.includes(viewer.role) &&
        !isCreator &&
        row.status === PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
      canCancel:
        isCreator && row.status === PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
      paymentRail: { driver: "SIMULATOR", simulated: true },
    };
  }

  private summary(row: {
    id: string;
    status: string;
    amountMinor: bigint;
    currency: string;
    beneficiaryName: string;
    beneficiaryReference: string | null;
    createdByUserId: string;
    decisionByUserId: string | null;
    decidedAt: Date | null;
    createdAt: Date;
    createdBy?: { id: string; username: string; email: string };
  }) {
    return {
      id: row.id,
      status: row.status,
      amountMinor: jsonMoney(row.amountMinor),
      currency: row.currency,
      beneficiaryName: row.beneficiaryName,
      beneficiaryReference: row.beneficiaryReference,
      createdByUserId: row.createdByUserId,
      createdBy: row.createdBy,
      decisionByUserId: row.decisionByUserId,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    };
  }

  async create(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    input: CreatePaymentInput,
    clientRequestId?: string,
  ) {
    assertBusinessRole(role);

    const amountMinor = parseAmount(input.amountMinor);
    const beneficiaryName = input.beneficiaryName.trim();
    if (beneficiaryName.length === 0 || beneficiaryName.length > 120)
      throw new ApiError(PAYMENT_ERRORS.BENEFICIARY_INVALID, 422);

    if (
      clientRequestId !== undefined &&
      !IDEMPOTENCY_PATTERN.test(clientRequestId)
    )
      throw new ApiError(PAYMENT_ERRORS.IDEMPOTENCY_INVALID, 400);

    const idempotencyKey = `payment-request:${businessId}:${actorUserId}:${
      clientRequestId ?? randomUUID()
    }`;

    try {
      const result = await this.db.$transaction(async (tx) => {
        const business = await tx.business.findUnique({
          where: { id: businessId },
          select: {
            status: true,
            currency: true,
            approvalThresholdMinor: true,
          },
        });
        if (!business || business.status !== BUSINESS_STATUS.ACTIVE)
          throw new ApiError(PAYMENT_ERRORS.BUSINESS_NOT_ACTIVE, 409);

        /* Re-read the membership inside the transaction: a disable between the
         * middleware and this write must stop the request. */
        const membership = await tx.businessMember.findFirst({
          where: {
            businessId,
            userId: actorUserId,
            status: MEMBERSHIP_STATUS.ACTIVE,
          },
          select: { id: true },
        });
        if (!membership)
          throw new ApiError(PAYMENT_ERRORS.APPROVER_ROLE_REQUIRED, 403);

        const existing = await tx.paymentRequest.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey },
          },
          include: REQUEST_INCLUDE,
        });
        if (existing) {
          return {
            row: existing,
            replayed: true,
          };
        }

        const requiresApproval = amountMinor >= business.approvalThresholdMinor;

        const created = await tx.paymentRequest.create({
          data: {
            businessId,
            createdByUserId: actorUserId,
            beneficiaryName,
            beneficiaryReference: trimmed(input.beneficiaryReference),
            memo: trimmed(input.memo),
            amountMinor,
            currency: business.currency,
            status: requiresApproval
              ? PAYMENT_REQUEST_STATUS.PENDING_APPROVAL
              : PAYMENT_REQUEST_STATUS.APPROVED,
            approvalThresholdMinor: business.approvalThresholdMinor,
            requiredApprovals: 1,
            approvalsCount: 0,
            idempotencyKey,
          },
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "USER",
            actorId: actorUserId,
            action: AUDIT_ACTION.PAYMENT_REQUEST_CREATED,
            resourceType: "PaymentRequest",
            resourceId: created.id,
            metadata: { paymentRequestId: created.id },
          }),
        });

        if (requiresApproval) {
          return {
            row: await tx.paymentRequest.findUniqueOrThrow({
              where: { id: created.id },
              include: REQUEST_INCLUDE,
            }),
            replayed: false,
          };
        }

        /*
         * Below the threshold the policy, not the initiator, approves. The
         * decision is attributed to SYSTEM (null decisionByUserId) and the
         * ledger still posts only through the shared primitive.
         */
        const posted = await this.ledger.postPaymentWithin(tx, {
          businessId,
          paymentRequestId: created.id,
          actorUserId,
          amountMinor,
          beneficiaryName,
        });

        const completed = await tx.paymentRequest.update({
          where: { id: created.id },
          data: {
            accountId: posted.accountId,
            status: PAYMENT_REQUEST_STATUS.COMPLETED,
            approvalsCount: 1,
            decidedAt: new Date(),
            ledgerTransactionId: (posted.transaction as { id: string }).id,
          },
          include: REQUEST_INCLUDE,
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "SYSTEM",
            actorId: null,
            action: AUDIT_ACTION.PAYMENT_REQUEST_APPROVED,
            resourceType: "PaymentRequest",
            resourceId: completed.id,
            metadata: {
              paymentRequestId: completed.id,
              policy: "BELOW_THRESHOLD_AUTO_APPROVAL",
            },
          }),
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "SYSTEM",
            actorId: null,
            action: AUDIT_ACTION.PAYMENT_REQUEST_POSTED,
            resourceType: "PaymentRequest",
            resourceId: completed.id,
            metadata: {
              paymentRequestId: completed.id,
              ledgerTransactionId: completed.ledgerTransactionId,
              policy: "BELOW_THRESHOLD_AUTO_APPROVAL",
            },
          }),
        });

        return { row: completed, replayed: false };
      });

      return {
        request: this.view(result.row, { userId: actorUserId, role }),
        replayed: result.replayed,
      };
    } catch (error) {
      /*
       * A concurrent request with the same client id hits the unique index.
       * Return the original rather than a 500 or a second payment.
       */
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.db.paymentRequest.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey },
          },
          include: REQUEST_INCLUDE,
        });
        if (existing)
          return {
            request: this.view(existing, { userId: actorUserId, role }),
            replayed: true,
          };
      }
      throw error;
    }
  }

  async list(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    query: ListQuery,
  ) {
    assertBusinessRole(role);

    const limit = Math.min(Math.max(Number(query.limit ?? 25) || 25, 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    /* Employees see their own requests only; the scope is in the WHERE clause. */
    const ownership =
      role === USER_ROLE.EMPLOYEE ? { createdByUserId: actorUserId } : {};

    const rows = await this.db.paymentRequest.findMany({
      where: {
        businessId,
        ...ownership,
        ...(query.status ? { status: query.status as never } : {}),
        ...(cursor
          ? {
              AND: [
                { createdAt: { lt: cursor.postedAt } },
                {
                  OR: [{ createdAt: cursor.postedAt, id: { lt: cursor.id } }],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        beneficiaryName: true,
        beneficiaryReference: true,
        createdByUserId: true,
        decisionByUserId: true,
        decidedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, username: true, email: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      requests: page.map((row) => this.summary(row)),
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async detail(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    id: string,
  ) {
    assertBusinessRole(role);

    const row = await this.db.paymentRequest.findFirst({
      where: { id, businessId },
      include: REQUEST_INCLUDE,
    });
    if (!row) throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);

    /* An employee must not learn that another employee's request exists. */
    if (role === USER_ROLE.EMPLOYEE && row.createdByUserId !== actorUserId)
      throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);

    return { request: this.view(row, { userId: actorUserId, role }) };
  }

  async queue(businessId: string, role: UserRole) {
    assertApprover(role);

    const rows = await this.db.paymentRequest.findMany({
      where: {
        businessId,
        status: PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        createdBy: { select: { id: true, username: true, email: true } },
      },
    });

    return {
      requests: rows.map((row) => this.summary(row)),
      count: rows.length,
    };
  }

  async approve(
    actorUserId: string,
    businessId: string,
    actorRole: UserRole,
    actorType: "USER",
    id: string,
    reason?: string,
  ) {
    assertApprover(actorRole);
    if (actorType !== "USER")
      throw new ApiError(PAYMENT_ERRORS.AGENT_FORBIDDEN, 403);

    try {
      const result = await this.db.$transaction(async (tx) => {
        await this.lockRequest(tx, id, businessId);
        const request = await tx.paymentRequest.findFirst({
          where: { id, businessId },
          include: REQUEST_INCLUDE,
        });
        if (!request) throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);

        /* Self-approval is the first refusal, even on a decided request. */
        if (request.createdByUserId === actorUserId)
          throw new ApiError(
            PAYMENT_ERRORS.SELF_APPROVAL_FORBIDDEN,
            STATUS_CODE.FORBIDDEN,
          );
        if (request.status !== PAYMENT_REQUEST_STATUS.PENDING_APPROVAL)
          throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);

        await this.assertActiveApprover(tx, businessId, actorUserId, actorRole);

        const approval = await tx.approval.create({
          data: {
            businessId,
            paymentRequestId: request.id,
            actorUserId,
            actorRole,
            decision: "APPROVED",
            reason: trimmed(reason),
          },
        });

        /*
         * Posts inside this transaction. A 409 insufficient-funds rolls the
         * approval row back too, so the request stays pending and untouched.
         */
        const posted = await this.ledger.postPaymentWithin(tx, {
          businessId,
          paymentRequestId: request.id,
          actorUserId,
          amountMinor: request.amountMinor,
          beneficiaryName: request.beneficiaryName,
        });

        const transitioned = await tx.paymentRequest.updateMany({
          where: {
            id: request.id,
            businessId,
            status: PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
          },
          data: {
            status: PAYMENT_REQUEST_STATUS.COMPLETED,
            decisionByUserId: actorUserId,
            decidedAt: new Date(),
            approvalsCount: { increment: 1 },
            accountId: posted.accountId,
            ledgerTransactionId: (posted.transaction as { id: string }).id,
          },
        });

        /* Another approver won the race between the lock and this update. */
        if (transitioned.count === 0)
          throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "USER",
            actorId: actorUserId,
            action: AUDIT_ACTION.PAYMENT_REQUEST_APPROVED,
            resourceType: "PaymentRequest",
            resourceId: request.id,
            metadata: {
              paymentRequestId: request.id,
              approvalId: approval.id,
            },
          }),
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "USER",
            actorId: actorUserId,
            action: AUDIT_ACTION.PAYMENT_REQUEST_POSTED,
            resourceType: "PaymentRequest",
            resourceId: request.id,
            metadata: {
              paymentRequestId: request.id,
              ledgerTransactionId: (posted.transaction as { id: string }).id,
            },
          }),
        });

        return tx.paymentRequest.findUniqueOrThrow({
          where: { id: request.id },
          include: REQUEST_INCLUDE,
        });
      });

      return {
        request: this.view(result, { userId: actorUserId, role: actorRole }),
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);
      throw error;
    }
  }

  async reject(
    actorUserId: string,
    businessId: string,
    actorRole: UserRole,
    actorType: "USER",
    id: string,
    reason: string,
  ) {
    assertApprover(actorRole);
    if (actorType !== "USER")
      throw new ApiError(PAYMENT_ERRORS.AGENT_FORBIDDEN, 403);
    const note = reason.trim();
    if (note.length < 3 || note.length > 280)
      throw new ApiError("A rejection reason must be 3-280 characters", 422);

    try {
      const result = await this.db.$transaction(async (tx) => {
        await this.lockRequest(tx, id, businessId);
        const request = await tx.paymentRequest.findFirst({
          where: { id, businessId },
          include: REQUEST_INCLUDE,
        });
        if (!request) throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);
        if (request.createdByUserId === actorUserId)
          throw new ApiError(
            PAYMENT_ERRORS.SELF_APPROVAL_FORBIDDEN,
            STATUS_CODE.FORBIDDEN,
          );
        if (request.status !== PAYMENT_REQUEST_STATUS.PENDING_APPROVAL)
          throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);

        await this.assertActiveApprover(tx, businessId, actorUserId, actorRole);

        const approval = await tx.approval.create({
          data: {
            businessId,
            paymentRequestId: request.id,
            actorUserId,
            actorRole,
            decision: "REJECTED",
            reason: note,
          },
        });

        await tx.paymentRequest.update({
          where: { id: request.id },
          data: {
            status: PAYMENT_REQUEST_STATUS.REJECTED,
            decisionByUserId: actorUserId,
            decidedAt: new Date(),
            approvalsCount: { increment: 1 },
          },
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "USER",
            actorId: actorUserId,
            action: AUDIT_ACTION.PAYMENT_REQUEST_REJECTED,
            resourceType: "PaymentRequest",
            resourceId: request.id,
            metadata: {
              paymentRequestId: request.id,
              approvalId: approval.id,
            },
          }),
        });

        return tx.paymentRequest.findUniqueOrThrow({
          where: { id: request.id },
          include: REQUEST_INCLUDE,
        });
      });

      return {
        request: this.view(result, { userId: actorUserId, role: actorRole }),
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);
      throw error;
    }
  }

  async cancel(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    id: string,
  ) {
    assertBusinessRole(role);

    const result = await this.db.$transaction(async (tx) => {
      const request = await tx.paymentRequest.findFirst({
        where: { id, businessId },
        include: REQUEST_INCLUDE,
      });
      if (!request) throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);
      if (request.createdByUserId !== actorUserId)
        throw new ApiError(PAYMENT_ERRORS.CANCEL_FORBIDDEN, 403);
      if (request.status !== PAYMENT_REQUEST_STATUS.PENDING_APPROVAL)
        throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);

      const transitioned = await tx.paymentRequest.updateMany({
        where: {
          id: request.id,
          businessId,
          status: PAYMENT_REQUEST_STATUS.PENDING_APPROVAL,
        },
        data: { status: PAYMENT_REQUEST_STATUS.CANCELED },
      });
      if (transitioned.count === 0)
        throw new ApiError(PAYMENT_ERRORS.ALREADY_DECIDED, 409);

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.PAYMENT_REQUEST_CANCELED,
          resourceType: "PaymentRequest",
          resourceId: request.id,
          metadata: { paymentRequestId: request.id },
        }),
      });

      return tx.paymentRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: REQUEST_INCLUDE,
      });
    });

    return {
      request: this.view(result, { userId: actorUserId, role }),
    };
  }

  /** Row lock: the other approver waits, then re-reads the decided status. */
  private async lockRequest(tx: Tx, id: string, businessId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PaymentRequest"
      WHERE id = ${id} AND "businessId" = ${businessId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new ApiError(PAYMENT_ERRORS.NOT_FOUND, 404);
  }

  /**
   * The JWT already proved the membership, but the service re-reads it inside
   * the transaction: a member disabled between the middleware and the approval
   * must not decide anything.
   */
  private async assertActiveApprover(
    tx: Tx,
    businessId: string,
    userId: string,
    role: UserRole,
  ) {
    const membership = await tx.businessMember.findFirst({
      where: {
        businessId,
        userId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        role: { in: APPROVER_ROLES },
      },
      select: { id: true, role: true },
    });
    if (!membership || membership.role !== role)
      throw new ApiError(PAYMENT_ERRORS.APPROVER_ROLE_REQUIRED, 403);
  }
}
