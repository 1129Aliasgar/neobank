/**
 * Verification-domain types and the provider seam.
 *
 * Everything in the app talks to `VerificationProvider`. Today the only real
 * implementation is Didit; the simulator exists so the flow is demoable before
 * a sandbox account exists, and a future provider is one more implementation
 * rather than a rewrite of the service.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type {
  VerificationEnvironment,
  VerificationStatus,
} from "../constants/constants.js";
import type { BusinessProfile } from "./business.types.js";

/** What the provider needs to open a session for one business attempt. */
export interface CreateProviderSessionInput {
  businessId: string;
  business: BusinessProfile;
  attemptNumber: number;
}

/** A created hosted session. The URL is a credential: never persist it. */
export interface ProviderSession {
  sessionId: string;
  url: string;
  /** Raw provider status, e.g. "Not Started". */
  status: string;
  environment: VerificationEnvironment;
  sandboxScenario: string | null;
  /**
   * Whether the hosted flow can be completed in a desktop browser. Didit
   * decides this per workflow; a KYB workflow that captures documents or key
   * people is commonly mobile-only. The UI must not offer "open on this
   * device" when this is false, because the hosted page refuses to advance.
   */
  desktopAllowed: boolean;
}

/** The subset of the provider decision we keep. */
export interface ProviderDecision {
  status: string;
  sandboxScenario: string | null;
  rejectLabels: string[];
  warnings: string[];
}

export interface VerificationProvider {
  /** Matches `VerificationProvider` in the schema for the real client. */
  readonly name: "DIDIT" | "SIMULATOR";
  readonly environment: VerificationEnvironment;
  /**
   * The workflow definition that produced the decision. A workflow can be
   * republished, so an attempt must record which definition it ran.
   */
  readonly workflowId: string | null;
  createSession(input: CreateProviderSessionInput): Promise<ProviderSession>;
  getDecision(sessionId: string): Promise<ProviderDecision>;
}

/** A provider failure we can translate into a 502 without leaking internals. */
export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(message: string, provider: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export interface VerificationRecord {
  id: string;
  businessId: string;
  provider: string;
  providerSessionId: string | null;
  workflowId: string | null;
  environment: VerificationEnvironment;
  sandboxScenario: string | null;
  status: VerificationStatus;
  providerStatus: string | null;
  reviewResult: unknown;
  rejectionReason: string | null;
  actionRequired: boolean;
  attemptNumber: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
