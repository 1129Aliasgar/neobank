/**
 * Persistence for provider webhook deliveries.
 *
 * The insert is the idempotency boundary: `@@unique([provider,
 * providerEventId])` makes a redelivery collide before any business effect can
 * run twice. The service turns that constraint error into a 200.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import type { Prisma } from "../generated/prisma/client.js";
import { TYPES } from "../config/types.js";
import { DbClient } from "../types/database.types.js";
import { WEBHOOK_STATUS } from "../constants/constants.js";

export interface CreateWebhookEventInput {
  provider: "DIDIT";
  providerEventId: string;
  eventType: string;
  businessId: string | null;
  resourceId: string | null;
  payload: Prisma.InputJsonObject;
  providerCreatedAt: Date | null;
  signatureVerified: boolean;
}

@injectable()
export default class WebhookRepository {
  private readonly db: DbClient;

  constructor(@inject(TYPES.PrismaClient) db: DbClient) {
    this.db = db;
  }

  async create(input: CreateWebhookEventInput) {
    return await this.db.webhookEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        businessId: input.businessId,
        resourceId: input.resourceId,
        payload: input.payload,
        providerCreatedAt: input.providerCreatedAt,
        signatureVerified: input.signatureVerified,
        status: WEBHOOK_STATUS.RECEIVED,
      },
    });
  }

  /**
   * The newest `created_at` already applied for this provider resource.
   * Didit does not guarantee ordering, so an older delivery is ignored.
   */
  async findLatestProcessedAt(resourceId: string): Promise<Date | null> {
    const event = await this.db.webhookEvent.findFirst({
      where: {
        resourceId,
        provider: "DIDIT",
        status: WEBHOOK_STATUS.PROCESSED,
        providerCreatedAt: { not: null },
      },
      orderBy: { providerCreatedAt: "desc" },
      select: { providerCreatedAt: true },
    });

    return event?.providerCreatedAt ?? null;
  }

  async markProcessed(id: string, note?: string): Promise<void> {
    await this.db.webhookEvent.update({
      where: { id },
      data: {
        status: WEBHOOK_STATUS.PROCESSED,
        processedAt: new Date(),
        ...(note ? { lastError: note } : {}),
      },
    });
  }

  /** Keeps the delivery record for ops while telling Didit to retry (500). */
  async markFailed(id: string, error: string): Promise<void> {
    await this.db.webhookEvent.update({
      where: { id },
      data: {
        status: WEBHOOK_STATUS.FAILED,
        attemptCount: { increment: 1 },
        lastError: error,
      },
    });
  }
}
