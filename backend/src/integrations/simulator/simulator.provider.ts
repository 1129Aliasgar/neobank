/**
 * Sandbox verification simulator.
 *
 * This is **not** a fake of the integration: it implements the same
 * `VerificationProvider` interface, drives the same status strings, and feeds
 * the same transition function as the real Didit client. It exists because
 * Didit's sandbox credentials are account-bound; until they are present the
 * whole onboarding flow can still be exercised end to end, and the API/UI are
 * labelled with `environment: "SANDBOX"` plus the chosen scenario.
 *
 * Production never reaches this class: `env.ts` refuses to boot without the
 * three Didit values when `NODE_ENV=production`.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import {
  ProviderError,
  type CreateProviderSessionInput,
  type ProviderDecision,
  type ProviderSession,
  type VerificationProvider,
} from "../../types/verification.types.js";
import { mapProviderStatus, isTerminal } from "../../utils/verificationStatus.js";

/** Scenario slug → the Didit status the real sandbox would emit. */
const SCENARIO_STATUS = {
  approve: "Approved",
  decline: "Declined",
  review: "In Review",
  pending: "In Progress",
  awaiting_user: "Awaiting User",
  abandon: "Abandoned",
  expire: "Expired",
} as const;

export type SimulatorScenario = keyof typeof SCENARIO_STATUS;

export const SIMULATOR_SCENARIOS = Object.keys(
  SCENARIO_STATUS,
) as SimulatorScenario[];

interface SimulatedSession {
  sessionId: string;
  businessId: string;
  /** A retry after a decline is a new attempt and must get a new session. */
  attemptNumber: number;
  status: string;
  scenario: SimulatorScenario | null;
}

function isFinished(status: string): boolean {
  return isTerminal(mapProviderStatus(status).verificationStatus);
}

export default class SimulatorProvider implements VerificationProvider {
  readonly name = "SIMULATOR" as const;
  readonly environment =
    env.didit.environment === "live" ? "LIVE" : "SANDBOX";
  readonly workflowId = null;

  /*
   * In-memory on purpose: the simulator backs one development process. A
   * restart resets sessions, which is acceptable because the persisted
   * `Verification` row is the source of truth and the decision can be re-armed
   * from the sandbox screen.
   */
  private readonly sessions = new Map<string, SimulatedSession>();
  private readonly byBusiness = new Map<string, string>();

  async createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSession> {
    const existingId = this.byBusiness.get(input.businessId);
    const existing = existingId ? this.sessions.get(existingId) : undefined;

    /*
     * Same resume semantics as Didit: one unfinished session per attempt. The
     * attempt number is part of the key because `providerSessionId` is unique —
     * after a decline the new attempt must not be handed the closed session.
     */
    if (
      existing &&
      existing.attemptNumber === input.attemptNumber &&
      !isFinished(existing.status)
    ) {
      return this.toSession(existing);
    }

    const session: SimulatedSession = {
      sessionId: `sim-${randomUUID()}`,
      businessId: input.businessId,
      attemptNumber: input.attemptNumber,
      status: "Not Started",
      scenario: null,
    };

    this.sessions.set(session.sessionId, session);
    this.byBusiness.set(input.businessId, session.sessionId);

    return this.toSession(session);
  }

  async getDecision(sessionId: string): Promise<ProviderDecision> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new ProviderError(
        "The simulated session no longer exists",
        this.name,
      );
    }

    return {
      status: session.status,
      sandboxScenario: session.scenario,
      rejectLabels:
        session.status === "Declined"
          ? ["sandbox_registry_mismatch"]
          : [],
      warnings: [],
    };
  }

  /**
   * Forced outcome for the sandbox screen. Returns the decision so the caller
   * can apply the same transition the webhook would.
   */
  simulate(sessionId: string, scenario: SimulatorScenario): ProviderDecision {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new ProviderError(
        "The simulated session no longer exists",
        this.name,
      );
    }

    session.scenario = scenario;
    session.status = SCENARIO_STATUS[scenario];

    return {
      status: session.status,
      sandboxScenario: scenario,
      rejectLabels:
        scenario === "decline" ? ["sandbox_registry_mismatch"] : [],
      warnings: [],
    };
  }

  private toSession(session: SimulatedSession): ProviderSession {
    return {
      sessionId: session.sessionId,
      /*
       * The real provider returns a URL on its own domain. The simulator sends
       * the browser to our sandbox screen, which is the equivalent action:
       * choose the outcome, then let the normal transition run.
       */
      url: `${env.frontendUrl}/onboarding/simulate?session=${encodeURIComponent(session.sessionId)}`,
      status: session.status,
      environment: this.environment,
      sandboxScenario: session.scenario,
      /* The sandbox console is a normal web page, so desktop is fine. */
      desktopAllowed: true,
    };
  }
}
