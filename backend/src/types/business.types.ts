/**
 * Business-domain types.
 *
 * The Prisma models are the source of truth; these interfaces are what the
 * service and controller layers see so they do not depend on generated code.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type {
  BusinessStatus,
  BusinessType,
  MembershipStatus,
  OnboardingStep,
  UserRole,
  VerificationEnvironment,
  VerificationStatus,
} from "../constants/constants.js";

/** The slice of a business that is safe to embed in an auth response. */
export interface BusinessSummary {
  id: string;
  legalName: string;
  currency: string;
  status: BusinessStatus;
}

/**
 * A user's relationship to a business. `role` and `status` are membership
 * fields, never user fields.
 */
export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: UserRole;
  status: MembershipStatus;
  joinedAt: Date | null;
}

/**
 * The stored profile columns, before the flat row is presented as a nested
 * address. Repositories produce this; `utils/businessMapper` turns it into
 * `BusinessProfile`.
 */
export interface BusinessRecord {
  id: string;
  legalName: string;
  tradingName: string | null;
  businessType: BusinessType | null;
  registrationNumber: string | null;
  industry: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  currency: string;
  status: BusinessStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Everything the registration transaction writes. */
export interface CreateOwnerAccountInput {
  user: {
    username: string;
    email: string;
    password: string;
  };
  business: {
    legalName: string;
    country: string;
  };
}

/** The address block returned by the API. Stored flat, presented nested. */
export interface BusinessAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
}

/** The full onboarding profile. Never contains an EIN or a document. */
export interface BusinessProfile {
  id: string;
  legalName: string;
  tradingName: string | null;
  businessType: BusinessType | null;
  registrationNumber: string | null;
  industry: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: BusinessAddress;
  currency: string;
  status: BusinessStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The flat fields `profileComplete` looks at. Declared explicitly rather than
 * picked from `BusinessProfile` because that shape nests the address while the
 * database and the auth projection keep it flat.
 */
export interface ProfileCompletenessInput {
  legalName: string;
  businessType: BusinessType | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

/** Any subset of the editable profile. `country` is fixed to US in v1. */
export interface UpdateBusinessInput {
  legalName?: string;
  tradingName?: string | null;
  businessType?: BusinessType;
  registrationNumber?: string | null;
  industry?: string | null;
  description?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
}

/** What the onboarding UI needs to know about the latest attempt. */
export interface VerificationSummary {
  id: string;
  status: VerificationStatus;
  provider: string;
  environment: VerificationEnvironment;
  sandboxScenario: string | null;
  attemptNumber: number;
  actionRequired: boolean;
  providerStatus: string | null;
  rejectionLabels: string[];
  rejectionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
}

/** Computed on every read, never stored. */
export interface OnboardingState {
  profileComplete: boolean;
  nextStep: OnboardingStep;
  verification: VerificationSummary | null;
}

/**
 * The routing hint embedded in auth responses. The full state (including the
 * latest attempt) is only returned by `GET /businesses/current`.
 */
export interface OnboardingHint {
  profileComplete: boolean;
  nextStep: OnboardingStep;
}

/** The single read the onboarding UI needs. */
export interface CurrentBusiness {
  business: BusinessProfile;
  role: UserRole;
  profileComplete: boolean;
  onboarding: OnboardingState;
}
