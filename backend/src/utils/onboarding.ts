/**
 * Onboarding derivation.
 *
 * Pure functions: given a business and its latest attempt, what is missing and
 * what should the UI do next. Nothing here is stored, so a webhook landing out
 * of order cannot leave a stale "next step" behind.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import {
  BUSINESS_STATUS,
  ONBOARDING_STEP,
  VERIFICATION_STATUS,
  type BusinessStatus,
  type OnboardingStep,
} from "../constants/constants.js";
import type {
  BusinessProfile,
  OnboardingState,
  ProfileCompletenessInput,
  VerificationSummary,
} from "../types/business.types.js";

/**
 * The fields the provider needs before a session is worth creating.
 *
 * `registrationNumber` is absent on purpose: Didit's hosted flow pre-fills it
 * when present but a sandbox company does not need to resolve in a registry.
 */
const REQUIRED_PROFILE_FIELDS = [
  "legalName",
  "businessType",
  "email",
  "state",
  "addressLine1",
  "city",
  "postalCode",
] as const;

function isFilled(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

/** Nested profile → the flat shape the completeness rule is written against. */
function completenessOf(
  profile: BusinessProfile,
): ProfileCompletenessInput {
  return {
    legalName: profile.legalName,
    businessType: profile.businessType,
    email: profile.email,
    addressLine1: profile.address.line1,
    city: profile.address.city,
    state: profile.address.state,
    postalCode: profile.address.postalCode,
  };
}

export function isProfileComplete(
  business: ProfileCompletenessInput,
): boolean {
  return REQUIRED_PROFILE_FIELDS.every((field) => isFilled(business[field]));
}

/** Which required fields are still empty. Used by the form hint, not stored. */
export function missingProfileFields(
  business: ProfileCompletenessInput,
): string[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => !isFilled(business[field]));
}

export function deriveNextStep(
  business: BusinessProfile,
  verification: VerificationSummary | null,
): OnboardingStep {
  const completeness = completenessOf(business);

  if (
    business.status === BUSINESS_STATUS.SUSPENDED ||
    business.status === BUSINESS_STATUS.CLOSED
  ) {
    return ONBOARDING_STEP.CONTACT_SUPPORT;
  }

  if (!isProfileComplete(completeness)) {
    return ONBOARDING_STEP.COMPLETE_PROFILE;
  }

  if (business.status === BUSINESS_STATUS.ACTIVE) {
    return ONBOARDING_STEP.DONE;
  }

  if (!verification) {
    return ONBOARDING_STEP.START_VERIFICATION;
  }

  switch (verification.status) {
    case VERIFICATION_STATUS.APPROVED:
      return ONBOARDING_STEP.DONE;

    case VERIFICATION_STATUS.NOT_STARTED:
      return ONBOARDING_STEP.OPEN_VERIFICATION;

    case VERIFICATION_STATUS.PENDING:
      return verification.actionRequired
        ? ONBOARDING_STEP.RETURN_TO_PROVIDER
        : ONBOARDING_STEP.WAIT_FOR_REVIEW;

    case VERIFICATION_STATUS.REVIEW:
      return ONBOARDING_STEP.WAIT_FOR_REVIEW;

    case VERIFICATION_STATUS.REJECTED:
      return ONBOARDING_STEP.FIX_AND_RETRY;

    default:
      return ONBOARDING_STEP.WAIT_FOR_REVIEW;
  }
}

/**
 * The narrower derivation used by auth responses, where only the business row
 * and not the latest attempt is loaded. It is a routing hint; the onboarding
 * guard still calls `GET /businesses/current` for the authoritative answer.
 */
export function deriveAuthNextStep(
  business: ProfileCompletenessInput & { status: BusinessStatus },
): OnboardingStep {
  if (
    business.status === BUSINESS_STATUS.SUSPENDED ||
    business.status === BUSINESS_STATUS.CLOSED
  ) {
    return ONBOARDING_STEP.CONTACT_SUPPORT;
  }

  if (!isProfileComplete(business)) {
    return ONBOARDING_STEP.COMPLETE_PROFILE;
  }

  return business.status === BUSINESS_STATUS.ACTIVE
    ? ONBOARDING_STEP.DONE
    : ONBOARDING_STEP.START_VERIFICATION;
}

export function buildOnboardingState(
  business: BusinessProfile,
  verification: VerificationSummary | null,
): OnboardingState {
  const profileComplete = isProfileComplete(completenessOf(business));

  return {
    profileComplete,
    nextStep: deriveNextStep(business, verification),
    verification,
  };
}
