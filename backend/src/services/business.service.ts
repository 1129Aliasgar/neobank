/**
 * Business profile use cases.
 *
 * The service owns the two rules the repository must not know about: which
 * fields are still editable, and what "complete" means at verification time.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import BusinessRepository from "../repositories/business.repository.js";
import VerificationService from "./verification.service.js";
import Logger from "../utils/logger.js";
import { toBusinessProfile } from "../utils/businessMapper.js";
import { buildOnboardingState } from "../utils/onboarding.js";
import {
  AUDIT_ACTION,
  BUSINESS_STATUS,
  STATUS_CODE,
  type UserRole,
} from "../constants/constants.js";
import { BUSINESS_ERRORS } from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import type {
  BusinessRecord,
  CurrentBusiness,
  UpdateBusinessInput,
} from "../types/business.types.js";

/**
 * Identity fields that are locked once the business is active: they were the
 * basis of the KYB decision. Contact and address corrections stay allowed.
 */
const IDENTITY_FIELDS = [
  "legalName",
  "businessType",
  "registrationNumber",
] as const;

/** An optional form field arrives as a string; "absent" is stored as NULL. */
function orNull(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

@injectable()
export default class BusinessService {
  @inject(TYPES.BusinessRepository)
  businessRepository!: BusinessRepository;

  @inject(TYPES.VerificationService)
  verificationService!: VerificationService;

  @inject(TYPES.Logger)
  logger!: Logger;

  /**
   * The single read the onboarding UI needs: profile, role, latest attempt and
   * the derived next step. `sync` lets a missed webhook be reconciled on load.
   */
  async getCurrent(
    businessId: string,
    role: UserRole,
    options: { sync?: boolean } = {},
  ): Promise<CurrentBusiness> {
    const business = await this.businessRepository.findById(businessId);

    if (!business) {
      throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, STATUS_CODE.NOT_FOUND);
    }

    const profile = toBusinessProfile(business);
    const verification = await this.verificationService.getLatest(businessId, {
      sync: options.sync ?? true,
    });
    const onboarding = buildOnboardingState(profile, verification);

    return {
      business: profile,
      role,
      profileComplete: onboarding.profileComplete,
      onboarding,
    };
  }

  /**
   * Partial save. Completeness is not enforced here — a form is allowed to
   * submit half-filled data and continue later; only starting verification
   * requires the full set.
   */
  async updateCurrent(
    userId: string,
    businessId: string,
    role: UserRole,
    input: UpdateBusinessInput,
  ): Promise<CurrentBusiness> {
    const business = await this.businessRepository.findById(businessId);

    if (!business) {
      throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, STATUS_CODE.NOT_FOUND);
    }

    if (
      business.status === BUSINESS_STATUS.SUSPENDED ||
      business.status === BUSINESS_STATUS.CLOSED
    ) {
      throw new ApiError(BUSINESS_ERRORS.NOT_EDITABLE, STATUS_CODE.CONFLICT);
    }

    const data = this.toUpdateData(input);

    if (business.status === BUSINESS_STATUS.ACTIVE) {
      const locked = IDENTITY_FIELDS.filter(
        (field) =>
          data[field] !== undefined && data[field] !== business[field],
      );

      if (locked.length > 0) {
        throw new ApiError(
          BUSINESS_ERRORS.IDENTITY_LOCKED,
          STATUS_CODE.CONFLICT,
        );
      }
    }

    const changed = this.changedFields(business, data);

    if (changed.length > 0) {
      await this.businessRepository.updateProfile(businessId, data, {
        businessId,
        actorType: "USER",
        actorId: userId,
        action: AUDIT_ACTION.BUSINESS_PROFILE_UPDATED,
        resourceType: "Business",
        resourceId: businessId,
        /* Field names only: an audit row is not a copy of the profile. */
        metadata: { fields: changed },
      });

      this.logger.info("business profile updated", {
        businessId,
        userId,
        fields: changed,
      });
    }

    /* `sync: false`: the profile write does not change the verification. */
    return await this.getCurrent(businessId, role, { sync: false });
  }

  /**
   * Builds the database patch explicitly instead of spreading the request.
   * An explicit map is what guarantees `role`, `status`, `id` and every other
   * column stay unreachable from the body, whatever the validator lets through.
   */
  private toUpdateData(input: UpdateBusinessInput): UpdateBusinessInput {
    const data: UpdateBusinessInput = {};

    if (input.legalName !== undefined) {
      data.legalName = input.legalName.trim();
    }

    if (input.tradingName !== undefined) {
      data.tradingName = orNull(input.tradingName);
    }

    if (input.businessType !== undefined) {
      data.businessType = input.businessType;
    }

    if (input.registrationNumber !== undefined) {
      data.registrationNumber = orNull(input.registrationNumber);
    }

    if (input.industry !== undefined) {
      data.industry = orNull(input.industry);
    }

    if (input.description !== undefined) {
      data.description = orNull(input.description);
    }

    if (input.email !== undefined) {
      data.email = orNull(input.email);
    }

    if (input.phone !== undefined) {
      data.phone = orNull(input.phone);
    }

    if (input.website !== undefined) {
      data.website = orNull(input.website);
    }

    if (input.addressLine1 !== undefined) {
      data.addressLine1 = orNull(input.addressLine1);
    }

    if (input.addressLine2 !== undefined) {
      data.addressLine2 = orNull(input.addressLine2);
    }

    if (input.city !== undefined) {
      data.city = orNull(input.city);
    }

    if (input.state !== undefined) {
      data.state = orNull(input.state);
    }

    if (input.postalCode !== undefined) {
      data.postalCode = orNull(input.postalCode);
    }

    if (input.country !== undefined) {
      data.country = input.country.toUpperCase();
    }

    return data;
  }

  private changedFields(
    business: BusinessRecord,
    data: UpdateBusinessInput,
  ): string[] {
    return Object.entries(data)
      .filter(([key, value]) => {
        const current = business[key as keyof BusinessRecord];
        const next = value === "" ? null : value;

        return value !== undefined && next !== current;
      })
      .map(([key]) => key);
  }
}
