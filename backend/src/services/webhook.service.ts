/**
 * Didit webhook pipeline.
 *
 * Order matters and is deliberate:
 *
 *   verify signature → parse → insert event (idempotency) → resolve attempt
 *   → reject out-of-order → apply transition → mark processed
 *
 * The event is stored even when the transition is ignored. A delivery that
 * cannot be explained afterwards is worse than one that is not handled: ops
 * needs the record to reconcile a disputed approval.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import type { IncomingHttpHeaders } from "node:http";
import { TYPES } from "../config/types.js";
import { env } from "../config/env.js";
import WebhookRepository from "../repositories/webhook.repository.js";
import VerificationRepository from "../repositories/verification.repository.js";
import BusinessRepository from "../repositories/business.repository.js";
import VerificationService from "./verification.service.js";
import Logger from "../utils/logger.js";
import { isUniqueConstraintViolation } from "../utils/prismaError.js";
import {
  decisionDetail,
  sanitiseDiditPayload,
  verifyDiditSignature,
  webhookCreatedAt,
  webhookEventId,
  type DiditWebhookPayload,
} from "../integrations/didit/didit.webhook.js";
import { STATUS_CODE } from "../constants/constants.js";
import {
  COMMON_ERRORS,
  VERIFICATION_ERRORS,
  WEBHOOK_ERRORS,
} from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import type { VerificationRecord } from "../types/verification.types.js";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * The only two event families that describe a verification session. Everything
 * else is stored for the audit trail and then left alone.
 */
const SESSION_WEBHOOK_TYPES = new Set<string>(["status.updated", "data.updated"]);

@injectable()
export default class WebhookService {
  @inject(TYPES.WebhookRepository)
  webhookRepository!: WebhookRepository;

  @inject(TYPES.VerificationRepository)
  verificationRepository!: VerificationRepository;

  @inject(TYPES.BusinessRepository)
  businessRepository!: BusinessRepository;

  @inject(TYPES.VerificationService)
  verificationService!: VerificationService;

  @inject(TYPES.Logger)
  logger!: Logger;

  async handle(
    rawBody: Buffer,
    headers: IncomingHttpHeaders,
  ): Promise<WebhookOutcome> {
    if (!env.didit.configured) {
      /* Without a secret every signature would verify against an empty key. */
      throw new ApiError(
        VERIFICATION_ERRORS.PROVIDER_UNAVAILABLE,
        STATUS_CODE.SERVICE_UNAVAILABLE,
      );
    }

    const signature = verifyDiditSignature(rawBody, headers);

    if (!signature.ok) {
      this.logger.warn("webhook rejected: signature verification failed", {
        reason: signature.reason,
      });

      throw new ApiError(
        signature.reason === "stale-timestamp"
          ? WEBHOOK_ERRORS.STALE_TIMESTAMP
          : WEBHOOK_ERRORS.INVALID_SIGNATURE,
        STATUS_CODE.UNAUTHORIZED,
      );
    }

    const payload = this.parse(rawBody);
    const webhookType = (payload.webhook_type ?? "status.updated").trim();
    const isSessionEvent = SESSION_WEBHOOK_TYPES.has(webhookType);

    /*
     * Entity events (`business.status.updated`, `user.status.updated`, ...)
     * carry `ACTIVE` / `FLAGGED` / `BLOCKED`, which is a different vocabulary
     * from a verification status. A destination frequently subscribes to both,
     * so they must never reach the decision mapper: "ACTIVE" would otherwise be
     * an unknown verification status and park a healthy attempt in REVIEW.
     */
    if (isSessionEvent && (!payload.status || !payload.status.trim())) {
      throw new ApiError(
        WEBHOOK_ERRORS.MALFORMED_PAYLOAD,
        STATUS_CODE.BAD_REQUEST,
      );
    }

    const providerCreatedAt = webhookCreatedAt(payload);
    const vendorBusinessId = await this.resolveVendorBusiness(payload);

    let event;

    try {
      event = await this.webhookRepository.create({
        provider: "DIDIT",
        providerEventId: webhookEventId(payload, rawBody),
        eventType: webhookType,
        businessId: vendorBusinessId,
        resourceId: payload.session_id ?? null,
        payload: sanitiseDiditPayload(payload),
        providerCreatedAt,
        signatureVerified: true,
      });
    } catch (error) {
      /* The unique index is the idempotency guarantee, not an application check. */
      if (isUniqueConstraintViolation(error)) {
        this.logger.info("webhook duplicate ignored", {
          eventId: payload.event_id,
          sessionId: payload.session_id,
        });

        return "duplicate";
      }

      throw error;
    }

    if (!isSessionEvent) {
      await this.webhookRepository.markProcessed(
        event.id,
        `Event type not handled by this module: ${webhookType}`,
      );

      this.logger.info("webhook stored but not applied", {
        eventId: event.id,
        webhookType,
      });

      return "ignored";
    }

    const verification = await this.resolveVerification(payload);

    if (!verification) {
      await this.webhookRepository.markFailed(
        event.id,
        "No verification matches this session or business",
      );

      this.logger.warn("webhook could not be matched to a verification", {
        eventId: event.id,
        sessionId: payload.session_id,
        businessId: vendorBusinessId,
      });

      return "ignored";
    }

    if (
      providerCreatedAt &&
      payload.session_id &&
      (await this.isOutOfOrder(payload.session_id, providerCreatedAt))
    ) {
      await this.webhookRepository.markProcessed(
        event.id,
        "Out-of-order delivery ignored",
      );

      this.logger.info("webhook ignored: older than the last applied event", {
        eventId: event.id,
        sessionId: payload.session_id,
        providerCreatedAt,
      });

      return "ignored";
    }

    /*
     * Narrowing guard. Every session event passed the check above, so this is
     * unreachable in practice; it keeps the compiler satisfied without casting.
     */
    const providerStatus = payload.status?.trim();

    if (!providerStatus) {
      throw new ApiError(
        WEBHOOK_ERRORS.MALFORMED_PAYLOAD,
        STATUS_CODE.BAD_REQUEST,
      );
    }

    const detail = decisionDetail(payload);

    try {
      const result = await this.verificationService.applyDecision({
        verification,
        decision: {
          status: providerStatus,
          sandboxScenario: payload.sandbox_scenario ?? null,
          rejectLabels: detail.rejectLabels,
          warnings: detail.warnings,
        },
        actorType: "SYSTEM",
        actorId: null,
        webhookEventId: event.id,
        /* The payload has only the status; a decline's reason lives on the
         * decision endpoint. */
        enrich: true,
      });

      if (!result.applied) {
        await this.webhookRepository.markProcessed(
          event.id,
          result.reason === "duplicate"
            ? "Duplicate decision ignored"
            : result.reason === "stale-provider"
              ? "Stale provider status ignored"
              : "Terminal decision conflict left for operations",
        );
      }

      return result.applied ? "processed" : "ignored";
    } catch (error) {
      await this.webhookRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error),
      );

      /* A 500 tells Didit to retry; the event stays for the next attempt. */
      throw error;
    }
  }

  private parse(rawBody: Buffer): DiditWebhookPayload {
    try {
      const parsed: unknown = JSON.parse(rawBody.toString("utf8"));

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }

      return parsed as DiditWebhookPayload;
    } catch {
      throw new ApiError(
        COMMON_ERRORS.VALIDATION_FAILED,
        STATUS_CODE.BAD_REQUEST,
      );
    }
  }

  /**
   * `vendor_data` is the business id we sent at session creation. It is checked
   * against the database so a malformed delivery cannot violate the foreign
   * key and turn a client error into a 500.
   */
  private async resolveVendorBusiness(
    payload: DiditWebhookPayload,
  ): Promise<string | null> {
    if (typeof payload.vendor_data !== "string" || !payload.vendor_data) {
      return null;
    }

    const business = await this.businessRepository.findById(payload.vendor_data);

    return business?.id ?? null;
  }

  private async resolveVerification(
    payload: DiditWebhookPayload,
  ): Promise<VerificationRecord | null> {
    if (payload.session_id) {
      const bySession =
        await this.verificationRepository.findByProviderSessionId(
          payload.session_id,
        );

      if (bySession) {
        return bySession;
      }
    }

    if (typeof payload.vendor_data === "string" && payload.vendor_data) {
      return (
        (await this.verificationRepository.findActiveByBusiness(
          payload.vendor_data,
        )) ??
        (await this.verificationRepository.findLatestByBusiness(
          payload.vendor_data,
        ))
      );
    }

    return null;
  }

  private async isOutOfOrder(
    sessionId: string,
    incoming: Date,
  ): Promise<boolean> {
    const latest =
      await this.webhookRepository.findLatestProcessedAt(sessionId);

    return latest !== null && incoming.getTime() < latest.getTime();
  }
}
