/**
 * Persistence for KYB attempts.
 *
 * A row per attempt: a rejected business retries and the earlier decision must
 * stay readable. The status-transition write is one transaction that touches
 * the attempt, the business, the audit log and (when a webhook triggered it)
 * the webhook event — either the whole decision is recorded or none of it is.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import type { Prisma } from "../generated/prisma/client.js";
import { TYPES } from "../config/types.js";
import { DbClient } from "../types/database.types.js";
import type { VerificationRecord } from "../types/verification.types.js";
import { auditEntry, type AuditEntryInput } from "../utils/audit.js";
import {
  ACTIVE_VERIFICATION_STATUSES,
  BUSINESS_STATUS,
  WEBHOOK_STATUS,
  type BusinessStatus,
  type VerificationEnvironment,
  type VerificationProvider,
  type VerificationStatus,
} from "../constants/constants.js";

/** Every column the API may see. `providerSessionId` is a join key, not a secret. */
const VERIFICATION_FIELDS = {
  id: true,
  businessId: true,
  provider: true,
  providerSessionId: true,
  workflowId: true,
  environment: true,
  sandboxScenario: true,
  status: true,
  providerStatus: true,
  reviewResult: true,
  rejectionReason: true,
  actionRequired: true,
  attemptNumber: true,
  submittedAt: true,
  reviewedAt: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Record<keyof VerificationRecord, true>;

export interface CreateAttemptInput {
  businessId: string;
  provider: VerificationProvider;
  providerSessionId: string | null;
  workflowId: string | null;
  environment: VerificationEnvironment;
  sandboxScenario: string | null;
  status: VerificationStatus;
  providerStatus: string | null;
  attemptNumber: number;
  audit: AuditEntryInput;
}

export interface ApplyDecisionInput {
  verificationId: string;
  businessId: string;
  verificationStatus: VerificationStatus;
  providerStatus: string;
  actionRequired: boolean;
  reviewResult: Prisma.InputJsonObject;
  rejectionReason: string | null;
  sandboxScenario: string | null;
  /** Null when the attempt had already been submitted. */
  submittedAt: Date | null;
  /** Null while the attempt is not terminal. */
  reviewedAt: Date | null;
  /** Null means "do not touch the business status". */
  businessStatus: BusinessStatus | null;
  audit: AuditEntryInput;
  webhookEventId?: string;
}

@injectable()
export default class VerificationRepository {
  private readonly db: DbClient;

  constructor(@inject(TYPES.PrismaClient) db: DbClient) {
    this.db = db;
  }

  async findLatestByBusiness(
    businessId: string,
  ): Promise<VerificationRecord | null> {
    return await this.db.verification.findFirst({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_FIELDS,
    });
  }

  /** An attempt that has not reached a terminal state (NOT_STARTED/PENDING/REVIEW). */
  async findActiveByBusiness(
    businessId: string,
  ): Promise<VerificationRecord | null> {
    return await this.db.verification.findFirst({
      where: {
        businessId,
        status: { in: ACTIVE_VERIFICATION_STATUSES },
      },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_FIELDS,
    });
  }

  async findByProviderSessionId(
    providerSessionId: string,
  ): Promise<VerificationRecord | null> {
    return await this.db.verification.findUnique({
      where: { providerSessionId },
      select: VERIFICATION_FIELDS,
    });
  }

  async countByBusiness(businessId: string): Promise<number> {
    return await this.db.verification.count({ where: { businessId } });
  }

  async listByBusiness(businessId: string): Promise<VerificationRecord[]> {
    return await this.db.verification.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: VERIFICATION_FIELDS,
    });
  }

  /**
   * Refreshes an existing attempt with the session the provider handed back.
   * Deliberately does not touch `status`/`providerStatus`: resuming a session
   * must not downgrade a pending or awaiting-user attempt back to NOT_STARTED.
   */
  async updateFromSession(
    verificationId: string,
    input: {
      providerSessionId: string | null;
      workflowId: string | null;
      environment: VerificationEnvironment;
      sandboxScenario: string | null;
    },
  ): Promise<VerificationRecord> {
    return await this.db.verification.update({
      where: { id: verificationId },
      data: {
        providerSessionId: input.providerSessionId,
        workflowId: input.workflowId,
        environment: input.environment,
        sandboxScenario: input.sandboxScenario,
        lastSyncedAt: new Date(),
      },
      select: VERIFICATION_FIELDS,
    });
  }

  /**
   * Records that the provider was read and nothing changed.
   *
   * Without this, a re-read that maps to the same status leaves `lastSyncedAt`
   * untouched, so every poll would hit the provider again.
   */
  async markSynced(verificationId: string): Promise<void> {
    await this.db.verification.update({
      where: { id: verificationId },
      data: { lastSyncedAt: new Date() },
    });
  }

  async createAttempt(
    input: CreateAttemptInput,
  ): Promise<VerificationRecord> {    const { audit, ...attempt } = input;

    return await this.db.$transaction(async (tx) => {
      const verification = await tx.verification.create({
        data: {
          businessId: attempt.businessId,
          provider: attempt.provider,
          providerSessionId: attempt.providerSessionId,
          workflowId: attempt.workflowId,
          environment: attempt.environment,
          sandboxScenario: attempt.sandboxScenario,
          status: attempt.status,
          providerStatus: attempt.providerStatus,
          attemptNumber: attempt.attemptNumber,
          lastSyncedAt: new Date(),
        },
        select: VERIFICATION_FIELDS,
      });

      await tx.auditLog.create({
        /* The audit row points at the verification it actually created. */
        data: auditEntry({ ...audit, resourceId: verification.id }),
      });

      return verification;
    });
  }

  /**
   * Records a provider decision.
   *
   * `businessStatus` is re-validated inside the transaction: a suspension may
   * have landed between the read and the write, and the operator state wins.
   */
  async applyDecision(
    input: ApplyDecisionInput,
  ): Promise<VerificationRecord> {
    return await this.db.$transaction(async (tx) => {
      const verification = await tx.verification.update({
        where: { id: input.verificationId },
        data: {
          status: input.verificationStatus,
          providerStatus: input.providerStatus,
          actionRequired: input.actionRequired,
          reviewResult: input.reviewResult,
          rejectionReason: input.rejectionReason,
          sandboxScenario: input.sandboxScenario,
          lastSyncedAt: new Date(),
          ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
          ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
        },
        select: VERIFICATION_FIELDS,
      });

      if (input.businessStatus) {
        const business = await tx.business.findUnique({
          where: { id: input.businessId },
          select: { status: true },
        });

        if (
          business &&
          business.status !== BUSINESS_STATUS.SUSPENDED &&
          business.status !== BUSINESS_STATUS.CLOSED
        ) {
          await tx.business.update({
            where: { id: input.businessId },
            data: { status: input.businessStatus },
          });
        }
      }

      await tx.auditLog.create({ data: auditEntry(input.audit) });

      if (input.webhookEventId) {
        await tx.webhookEvent.update({
          where: { id: input.webhookEventId },
          data: {
            status: WEBHOOK_STATUS.PROCESSED,
            processedAt: new Date(),
          },
        });
      }

      return verification;
    });
  }

  /** Polling fallback: refresh the sync marker without changing the decision. */
  async touchLastSynced(verificationId: string): Promise<void> {
    await this.db.verification.update({
      where: { id: verificationId },
      data: { lastSyncedAt: new Date() },
    });
  }
}
