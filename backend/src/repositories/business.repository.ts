/**
 * Persistence for the business profile.
 *
 * Every method is scoped by `businessId`; the repository never chooses which
 * business to read. Profile writes and their audit row are one transaction, so
 * an "updated" field can always be explained by a matching audit entry.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import { DbClient } from "../types/database.types.js";
import type { BusinessRecord, UpdateBusinessInput } from "../types/business.types.js";
import type { AuditEntryInput } from "../utils/audit.js";
import { auditEntry } from "../utils/audit.js";
import {
  MEMBERSHIP_STATUS,
  type BusinessStatus,
} from "../constants/constants.js";

/** Everything the API exposes about a business. No EIN, no documents. */
const BUSINESS_PROFILE = {
  id: true,
  legalName: true,
  tradingName: true,
  businessType: true,
  registrationNumber: true,
  industry: true,
  description: true,
  email: true,
  phone: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  currency: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Record<keyof BusinessRecord, true>;

@injectable()
export default class BusinessRepository {
  private readonly db: DbClient;

  constructor(@inject(TYPES.PrismaClient) db: DbClient) {
    this.db = db;
  }

  async findById(businessId: string): Promise<BusinessRecord | null> {
    return await this.db.business.findUnique({
      where: { id: businessId },
      select: BUSINESS_PROFILE,
    });
  }

  /** The caller's role, re-read so a token cannot outlive a role change. */
  async findMembershipRole(businessId: string, userId: string) {
    return await this.db.businessMember.findFirst({
      where: {
        businessId,
        userId,
        status: MEMBERSHIP_STATUS.ACTIVE,
      },
      select: { role: true },
    });
  }

  /**
   * Applies a partial update and writes the audit row atomically.
   *
   * `data` is built by the service from a validated body, so no key here comes
   * from the client unchecked. The audit metadata records field *names* only.
   */
  async updateProfile(
    businessId: string,
    data: UpdateBusinessInput,
    audit: AuditEntryInput,
  ): Promise<BusinessRecord> {
    return await this.db.$transaction(async (tx) => {
      const business = await tx.business.update({
        where: { id: businessId },
        data,
        select: BUSINESS_PROFILE,
      });

      await tx.auditLog.create({ data: auditEntry(audit) });

      return business;
    });
  }

  /** Lifecycle moves owned by the verification flow (e.g. a retry reopens). */
  async setStatus(businessId: string, status: BusinessStatus): Promise<void> {
    await this.db.business.update({
      where: { id: businessId },
      data: { status },
    });
  }
}
