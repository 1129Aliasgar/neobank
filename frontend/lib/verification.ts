/**
 * Verification calls.
 *
 * `verificationUrl` is a short-lived credential: it is rendered and opened,
 * never stored, logged or put in a query string of our own pages.
 */

import { api, type ApiSuccess } from "./api";
import type {
  VerificationEnvironment,
  VerificationStatus,
  VerificationSummary,
} from "./business";

export type SimulatorScenario =
  | "approve"
  | "decline"
  | "review"
  | "pending"
  | "awaiting_user"
  | "abandon"
  | "expire";

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

export const verificationApi = {
  async start(): Promise<StartVerificationResult> {
    const { data } = await api.post<ApiSuccess<StartVerificationResult>>(
      "/businesses/current/verification",
      {},
    );

    return data.data;
  },

  async latest(): Promise<VerificationSummary | null> {
    const { data } = await api.get<
      ApiSuccess<{ verification: VerificationSummary | null }>
    >("/businesses/current/verification");

    return data.data.verification;
  },

  /** Sandbox only; the API returns 403 when the real provider is active. */
  async simulate(scenario: SimulatorScenario): Promise<VerificationSummary> {
    const { data } = await api.post<
      ApiSuccess<{ verification: VerificationSummary }>
    >("/businesses/current/verification/simulate", { scenario });

    return data.data.verification;
  },
};
