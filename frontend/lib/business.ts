/**
 * Business profile calls and the onboarding contract.
 *
 * Types mirror the API response in `planning/feature0.md` §6.2. The business id
 * is never sent: the API scopes every read and write to the token.
 */

import { api, type ApiSuccess } from "./api";
import type {
  BusinessStatus,
  OnboardingStep,
  UserRole,
} from "./auth";

export type BusinessType =
  | "LLC"
  | "CORPORATION"
  | "PARTNERSHIP"
  | "SOLE_PROPRIETORSHIP";

export type VerificationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "REVIEW";

export type VerificationEnvironment = "SANDBOX" | "LIVE";

export interface BusinessAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
}

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
  createdAt: string;
  updatedAt: string;
}

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
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface OnboardingState {
  profileComplete: boolean;
  nextStep: OnboardingStep;
  verification: VerificationSummary | null;
}

export interface CurrentBusiness {
  business: BusinessProfile;
  role: UserRole;
  profileComplete: boolean;
  onboarding: OnboardingState;
}

/** The PATCH body. Empty strings clear optional fields server-side. */
export interface UpdateBusinessInput {
  legalName?: string;
  tradingName?: string;
  businessType?: BusinessType;
  registrationNumber?: string;
  industry?: string;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export const businessApi = {
  async getCurrent(): Promise<CurrentBusiness> {
    const { data } = await api.get<ApiSuccess<CurrentBusiness>>(
      "/businesses/current",
    );

    return data.data;
  },

  async update(input: UpdateBusinessInput): Promise<CurrentBusiness> {
    const { data } = await api.patch<ApiSuccess<CurrentBusiness>>(
      "/businesses/current",
      input,
    );

    return data.data;
  },
};

/** Where the guard sends a user for a given server-derived next step. */
export function routeForStep(step: OnboardingStep): string {
  switch (step) {
    case "COMPLETE_PROFILE":
      return "/onboarding/business";

    case "START_VERIFICATION":
    case "OPEN_VERIFICATION":
      return "/onboarding/verify";

    case "DONE":
      return "/dashboard";

    /*
     * A rejection, a pending decision and a manual review all land on the same
     * page. That page is where the record lives, so it is also where "retry"
     * and "correct the details" belong.
     */
    case "WAIT_FOR_REVIEW":
    case "RETURN_TO_PROVIDER":
    case "FIX_AND_RETRY":
    case "CONTACT_SUPPORT":
      return "/onboarding/status";

    default:
      return "/onboarding/status";
  }
}
