/**
 * KYB orchestration.
 *
 * Three rules hold the module together:
 *
 *   1. No `Verification` row is written before the provider has accepted the
 *      session. A provider outage must not leave an attempt that cannot be
 *      opened.
 *   2. Exactly one unfinished attempt per business. Our active-row check and
 *      the partial unique index both enforce it.
 *   3. Webhook, polling fallback and the sandbox simulator all funnel through
 *      `applyDecision`, which uses `planDecision` — one place decides whether a
 *      status may move.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import BusinessRepository from "../repositories/business.repository.js";
import VerificationRepository from "../repositories/verification.repository.js";
import Logger from "../utils/logger.js";
import { toBusinessProfile } from "../utils/businessMapper.js";
import { isProfileComplete } from "../utils/onboarding.js";
import {
  isTerminal,
  mapProviderStatus,
  planDecision,
} from "../utils/verificationStatus.js";
import {
  AUDIT_ACTION,
  BUSINESS_STATUS,
  STATUS_CODE,
  VERIFICATION_STATUS,
  type AuditActorType,
  type VerificationEnvironment,
  type VerificationStatus,
} from "../constants/constants.js";
import {
  BUSINESS_ERRORS,
  VERIFICATION_ERRORS,
} from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import {
  ProviderError,
  type ProviderDecision,
  type VerificationProvider,
  type VerificationRecord,
} from "../types/verification.types.js";
import type { VerificationSummary } from "../types/business.types.js";
import {
  asSimulator,
  type SimulatorScenario,
} from "../integrations/verification.factory.js";

/** How long a polled decision is trusted before hitting the provider again. */
const SYNC_STALE_MS = 30_000;

/** Hosted sessions expire on the provider's side; the UI only needs a hint. */
const SESSION_TTL_SECONDS = 1800;

export interface StartVerificationResult {
  verificationId: string;
  provider: string;
  environment: VerificationEnvironment;
  status: VerificationStatus;
  attemptNumber: number;
  providerSessionId: string | null;
  verificationUrl: string;
  qr: { payload: string; ttlSeconds: number };
  /** False when the provider's workflow only runs on a phone. */
  desktopAllowed: boolean;
}

export interface ApplyDecisionInput {
  verification: VerificationRecord;
  decision: ProviderDecision;
  actorType: AuditActorType;
  actorId: string | null;
  webhookEventId?: string;
  /**
   * Webhook payloads carry only the status; a rejection's reason is on the
   * decision endpoint. When set, an empty-label rejection is re-read once.
   */
  enrich?: boolean;
}

export interface ApplyDecisionResult {
  applied: boolean;
  reason:
    | "duplicate"
    | "terminal-conflict"
    | "stale-provider"
    | null;
  verification: VerificationRecord;
}

function rejectionLabels(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const labels = (value as Record<string, unknown>).rejectLabels;

  return Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : [];
}

@injectable()
export default class VerificationService {
  @inject(TYPES.VerificationProvider)
  provider!: VerificationProvider;

  @inject(TYPES.BusinessRepository)
  businessRepository!: BusinessRepository;

  @inject(TYPES.VerificationRepository)
  verificationRepository!: VerificationRepository;

  @inject(TYPES.Logger)
  logger!: Logger;

  /**
   * Starts an attempt, or resumes the unfinished one. Both the persisted
   * active-row check and the provider's own idempotency make a double-click
   * harmless.
   */
  async start(
    userId: string,
    businessId: string,
  ): Promise<StartVerificationResult> {
    const business = await this.businessRepository.findById(businessId);

    if (!business) {
      throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, STATUS_CODE.NOT_FOUND);
    }

    if (business.status === BUSINESS_STATUS.ACTIVE) {
      throw new ApiError(
        BUSINESS_ERRORS.ALREADY_VERIFIED,
        STATUS_CODE.CONFLICT,
      );
    }

    if (
      business.status === BUSINESS_STATUS.SUSPENDED ||
      business.status === BUSINESS_STATUS.CLOSED
    ) {
      throw new ApiError(
        BUSINESS_ERRORS.NOT_EDITABLE,
        STATUS_CODE.CONFLICT,
      );
    }

    const profile = toBusinessProfile(business);

    if (!isProfileComplete(business)) {
      throw new ApiError(
        BUSINESS_ERRORS.PROFILE_INCOMPLETE,
        STATUS_CODE.INPROCESSABLE_ENTITY,
      );
    }

    const active = await this.verificationRepository.findActiveByBusiness(
      businessId,
    );

    if (active?.status === VERIFICATION_STATUS.REVIEW) {
      throw new ApiError(
        VERIFICATION_ERRORS.IN_REVIEW,
        STATUS_CODE.CONFLICT,
      );
    }

    const attemptNumber =
      active?.attemptNumber ??
      (await this.verificationRepository.countByBusiness(businessId)) + 1;

    let session;

    try {
      session = await this.provider.createSession({
        businessId,
        business: profile,
        attemptNumber,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.error("verification provider rejected session create", {
          businessId,
          provider: error.provider,
          status: error.status,
        });

        throw new ApiError(
          VERIFICATION_ERRORS.PROVIDER_UNAVAILABLE,
          STATUS_CODE.BAD_GATEWAY,
        );
      }

      throw error;
    }

    /*
     * A session id identifies exactly one attempt (the webhook router depends on
     * it). If the provider hands back an id already stored on a different row —
     * e.g. it resumed a closed session instead of opening a new one — writing it
     * would violate the unique index and turn a provider quirk into a 500.
     */
    if (session.sessionId && session.sessionId !== active?.providerSessionId) {
      const owner =
        await this.verificationRepository.findByProviderSessionId(
          session.sessionId,
        );

      if (owner && owner.id !== active?.id) {
        this.logger.error(
          "provider returned a session id already recorded on another attempt",
          {
            businessId,
            attemptNumber: owner.attemptNumber,
            ownerStatus: owner.status,
          },
        );

        throw new ApiError(
          VERIFICATION_ERRORS.PROVIDER_UNAVAILABLE,
          STATUS_CODE.BAD_GATEWAY,
        );
      }
    }

    const record = active
      ? await this.verificationRepository.updateFromSession(active.id, {
          providerSessionId: session.sessionId,
          workflowId: this.provider.workflowId,
          environment: session.environment,
          sandboxScenario: session.sandboxScenario,
        })
      : await this.verificationRepository.createAttempt({
          businessId,
          provider: this.provider.name,
          providerSessionId: session.sessionId,
          workflowId: this.provider.workflowId,
          environment: session.environment,
          sandboxScenario: session.sandboxScenario,
          status: VERIFICATION_STATUS.NOT_STARTED,
          providerStatus: session.status,
          attemptNumber,
          audit: {
            businessId,
            actorType: "USER",
            actorId: userId,
            action: AUDIT_ACTION.VERIFICATION_STARTED,
            resourceType: "Verification",
            /* Replaced by the real id inside the repository transaction. */
            resourceId: "pending",
            metadata: { attemptNumber, provider: this.provider.name },
          },
        });

    /*
     * A retry reopens a rejected business. The attempt row is created first so
     * the audit trail names a real id, so the status move is a second write.
     */
    if (
      !active &&
      business.status === BUSINESS_STATUS.REJECTED
    ) {
      await this.businessRepository.setStatus(
        businessId,
        BUSINESS_STATUS.PENDING_VERIFICATION,
      );
    }

    this.logger.info("verification session created", {
      businessId,
      verificationId: record.id,
      provider: record.provider,
      attemptNumber,
      environment: record.environment,
    });

    return {
      verificationId: record.id,
      provider: record.provider,
      environment: record.environment,
      status: record.status,
      attemptNumber: record.attemptNumber,
      providerSessionId: record.providerSessionId,
      verificationUrl: session.url,
      qr: { payload: session.url, ttlSeconds: SESSION_TTL_SECONDS },
      desktopAllowed: session.desktopAllowed,
    };
  }

  /**
   * Latest attempt, optionally reconciled with the provider.
   *
   * `sync` is the recovery path for a missed webhook: when the cached answer is
   * older than 30 s the decision endpoint is read and applied through the same
   * transition function. A provider failure is logged and swallowed — the
   * status page must still render.
   */
  async getLatest(
    businessId: string,
    options: { sync?: boolean } = {},
  ): Promise<VerificationSummary | null> {
    const record = await this.verificationRepository.findLatestByBusiness(
      businessId,
    );

    if (!record) {
      return null;
    }

    if (!options.sync || !this.shouldSync(record)) {
      return this.summarise(record);
    }

    try {
      const decision = await this.provider.getDecision(
        record.providerSessionId as string,
      );

      const result = await this.applyDecision({
        verification: record,
        decision,
        actorType: "SYSTEM",
        actorId: null,
      });

      /*
       * A no-op read still counts as a sync. Otherwise the stale check keeps
       * returning true and the status page hits the provider every few seconds.
       */
      if (!result.applied) {
        await this.verificationRepository.markSynced(record.id);
      }

      return this.summarise(result.verification);
    } catch (error) {
      this.logger.warn("verification sync failed; serving cached state", {
        businessId,
        verificationId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.summarise(record);
    }
  }

  async history(businessId: string): Promise<VerificationSummary[]> {
    const records =
      await this.verificationRepository.listByBusiness(businessId);

    return records.map((record) => this.summarise(record));
  }

  /**
   * Sandbox-only: force the outcome of the current simulated session, then run
   * the normal transition. Disabled when the real provider is configured.
   */
  async simulate(
    userId: string,
    businessId: string,
    scenario: SimulatorScenario,
  ): Promise<VerificationSummary> {
    const simulator = asSimulator(this.provider);

    if (!simulator) {
      throw new ApiError(
        VERIFICATION_ERRORS.SIMULATOR_DISABLED,
        STATUS_CODE.FORBIDDEN,
      );
    }

    const active = await this.verificationRepository.findActiveByBusiness(
      businessId,
    );

    if (!active || !active.providerSessionId) {
      throw new ApiError(
        VERIFICATION_ERRORS.NOT_ACTIVE,
        STATUS_CODE.CONFLICT,
      );
    }

    const decision = simulator.simulate(active.providerSessionId, scenario);

    const result = await this.applyDecision({
      verification: active,
      decision,
      actorType: "AGENT",
      actorId: userId,
    });

    return this.summarise(result.verification);
  }

  /**
   * The single write path for a provider decision.
   *
   * Shared by the webhook, the polling fallback and the simulator so the three
   * cannot disagree about what "Declined" or "Abandoned" means.
   */
  async applyDecision(
    input: ApplyDecisionInput,
  ): Promise<ApplyDecisionResult> {
    const { verification } = input;
    let decision = input.decision;

    /*
     * The `status.updated` webhook for a decline carries no labels (Didit only
     * puts them on the decision endpoint). Read the full decision once so the
     * retry page can show the actual reason instead of a bare "declined".
     */
    if (
      input.enrich &&
      decision.rejectLabels.length === 0 &&
      verification.providerSessionId &&
      mapProviderStatus(decision.status).verificationStatus ===
        VERIFICATION_STATUS.REJECTED
    ) {
      try {
        decision = await this.provider.getDecision(
          verification.providerSessionId,
        );
      } catch (error) {
        this.logger.warn("could not read rejection details", {
          verificationId: verification.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const business = await this.businessRepository.findById(
      verification.businessId,
    );

    if (!business) {
      throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, STATUS_CODE.NOT_FOUND);
    }

    const mapped = mapProviderStatus(decision.status);
    const plan = planDecision({
      current: verification.status,
      mapped,
      businessStatus: business.status,
    });

    if (!plan.apply) {
      this.logger.info("provider decision ignored", {
        verificationId: verification.id,
        businessId: verification.businessId,
        reason: plan.reason,
        providerStatus: decision.status,
      });

      return {
        applied: false,
        reason: plan.reason,
        verification,
      };
    }

    const now = new Date();
    const terminal = isTerminal(mapped.verificationStatus);

    const updated = await this.verificationRepository.applyDecision({
      verificationId: verification.id,
      businessId: verification.businessId,
      verificationStatus: mapped.verificationStatus,
      providerStatus: decision.status,
      actionRequired: mapped.actionRequired,
      reviewResult: {
        status: decision.status,
        rejectLabels: decision.rejectLabels,
        warnings: decision.warnings,
      },
      rejectionReason: decision.rejectLabels.join(", ") || null,
      sandboxScenario: decision.sandboxScenario ?? verification.sandboxScenario,
      submittedAt:
        verification.submittedAt ??
        (mapped.verificationStatus === VERIFICATION_STATUS.NOT_STARTED
          ? null
          : now),
      reviewedAt: terminal ? now : null,
      businessStatus: plan.businessStatus,
      audit: {
        businessId: verification.businessId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: AUDIT_ACTION.VERIFICATION_STATUS_CHANGED,
        resourceType: "Verification",
        resourceId: verification.id,
        metadata: {
          from: verification.status,
          to: mapped.verificationStatus,
          providerStatus: decision.status,
          businessStatus: plan.businessStatus,
        },
      },
      webhookEventId: input.webhookEventId,
    });

    this.logger.info("verification status applied", {
      verificationId: updated.id,
      businessId: updated.businessId,
      from: verification.status,
      to: updated.status,
      providerStatus: decision.status,
      businessStatus: plan.businessStatus,
    });

    return { applied: true, reason: null, verification: updated };
  }

  /** The onboarding UI's subset. Never the provider's raw decision body. */
  summarise(record: VerificationRecord): VerificationSummary {
    return {
      id: record.id,
      status: record.status,
      provider: record.provider,
      environment: record.environment,
      sandboxScenario: record.sandboxScenario,
      attemptNumber: record.attemptNumber,
      actionRequired: record.actionRequired,
      providerStatus: record.providerStatus,
      rejectionLabels: rejectionLabels(record.reviewResult),
      rejectionReason: record.rejectionReason,
      submittedAt: record.submittedAt,
      reviewedAt: record.reviewedAt,
    };
  }

  /** Poll only while the answer can still change and the cache is stale. */
  private shouldSync(record: VerificationRecord): boolean {
    if (isTerminal(record.status) || !record.providerSessionId) {
      return false;
    }

    if (!record.lastSyncedAt) {
      return true;
    }

    return Date.now() - record.lastSyncedAt.getTime() > SYNC_STALE_MS;
  }
}

