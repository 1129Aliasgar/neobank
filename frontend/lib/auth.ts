/**
 * Auth calls for the NeoBank API.
 *
 * The functions unwrap the API's `{ data, success }` envelope and keep the
 * Bearer token in sync, so a form only has to handle `AuthResult` or
 * `ApiClientError`.
 */

import { api, tokenStore, type ApiSuccess } from "./api";

export type UserRole = "OWNER" | "ADMIN" | "EMPLOYEE" | "OPERATIONS";

export type BusinessStatus =
  "PENDING_VERIFICATION" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "CLOSED";

export type OnboardingStep =
  | "COMPLETE_PROFILE"
  | "START_VERIFICATION"
  | "OPEN_VERIFICATION"
  | "WAIT_FOR_REVIEW"
  | "RETURN_TO_PROVIDER"
  | "FIX_AND_RETRY"
  | "DONE"
  | "CONTACT_SUPPORT";

export interface BusinessSummary {
  id: string;
  legalName: string;
  currency: string;
  status: BusinessStatus;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  business: BusinessSummary;
  createdAt: string;
  updatedAt: string;
}

/** Routing hint from the server; `GET /businesses/current` is authoritative. */
export interface OnboardingHint {
  profileComplete: boolean;
  nextStep: OnboardingStep;
}

export interface AuthResult {
  user: UserProfile;
  token: string;
  onboarding: OnboardingHint;
}

export interface SessionResult {
  user: UserProfile;
  onboarding: OnboardingHint;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  /** Optional: the API derives a name from the username when omitted. */
  businessName?: string;
  /** ISO 3166-1 alpha-2, defaults to US. */
  country?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const { data } = await api.post<ApiSuccess<AuthResult>>(
      "/auth/register",
      input,
    );

    tokenStore.set(data.data.token);

    return data.data;
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const { data } = await api.post<ApiSuccess<AuthResult>>(
      "/auth/login",
      input,
    );

    tokenStore.set(data.data.token);

    return data.data;
  },

  /** Authoritative session read. */
  async session(): Promise<SessionResult> {
    const { data } = await api.get<ApiSuccess<SessionResult>>("/auth/me");

    return data.data;
  },

  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } catch {
      /* An already-invalid token is still a successful local sign-out. */
    } finally {
      tokenStore.clear();
    }
  },
};
