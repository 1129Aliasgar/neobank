/**
 * Didit HTTP client.
 *
 * Transport only: no business rules, no database, no logger of request bodies.
 * The API key stays server-side; the `session_token` embedded in the hosted URL
 * is a credential and is never persisted or logged.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { injectable } from "inversify";
import { env } from "../../config/env.js";
import {
  ProviderError,
  type CreateProviderSessionInput,
  type ProviderDecision,
  type ProviderSession,
  type VerificationProvider,
} from "../../types/verification.types.js";
import type {
  DiditCreateSessionResponse,
  DiditDecisionResponse,
} from "./didit.types.js";

const TIMEOUT_MS = 10_000;

@injectable()
export default class DiditClient implements VerificationProvider {
  readonly name = "DIDIT" as const;
  readonly environment = env.didit.environment === "live" ? "LIVE" : "SANDBOX";
  readonly workflowId = env.didit.workflowId || null;

  /** Workflow metadata is static for the process lifetime; read it once. */
  private desktopAllowedCache: boolean | null = null;

  async createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSession> {
    const callback = this.callbackUrl();

    const body = {
      workflow_id: env.didit.workflowId,
      /*
       * Our business id, not a session id: the webhook echoes it back, so an
       * event can still be resolved if the row that stored the session was
       * never written.
       */
      vendor_data: input.businessId,
      /*
       * A phone that finishes the flow cannot resolve `localhost`, so the
       * callback is omitted until a public web origin exists. Didit then shows
       * its own result screen; the webhook and the status page's polling still
       * move our state.
       */
      ...(callback ? { callback, callback_method: "both" as const } : {}),
      metadata: {
        businessId: input.businessId,
        attemptNumber: input.attemptNumber,
        environment: env.didit.environment,
      },
      expected_details: {
        company_name: input.business.legalName,
        registry_country: this.registryCountry(input.business.address.state),
        ...(input.business.registrationNumber
          ? { registration_number: input.business.registrationNumber }
          : {}),
      },
    };

    const response = await this.request<DiditCreateSessionResponse>(
      "POST",
      "/v3/session/",
      body,
    );

    if (!response.session_id || !response.url) {
      throw new ProviderError(
        "Didit returned a session without an id or url",
        this.name,
      );
    }

    return {
      sessionId: response.session_id,
      url: response.url,
      status: response.status ?? "Not Started",
      environment: this.environment,
      sandboxScenario: response.sandbox_scenario ?? null,
      desktopAllowed: await this.desktopAllowed(),
    };
  }

  async getDecision(sessionId: string): Promise<ProviderDecision> {
    const response = await this.request<DiditDecisionResponse>(
      "GET",
      `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
    );

    return {
      status: response.status ?? "In Review",
      sandboxScenario: response.sandbox_scenario ?? null,
      rejectLabels: this.rejectLabels(response),
      warnings: this.warnings(response),
    };
  }

  /**
   * Where to send the browser after the hosted flow.
   *
   * A mobile-only check is usually finished on a phone, and `localhost` there
   * means the phone itself. With no public web origin configured we return
   * `null` and Didit simply shows its own "you are verified" screen instead of
   * redirecting into a connection error.
   */
  private callbackUrl(): string | null {
    const base = env.publicWebUrl || env.frontendUrl;

    if (!base) {
      return null;
    }

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(
      base,
    );

    if (!env.publicWebUrl && isLocal) {
      return null;
    }

    return `${base.replace(/\/+$/, "")}/onboarding/status`;
  }

  /**
   * Reads `is_desktop_allowed` from the workflow.
   *
   * A failure here must not block session creation: the value only affects
   * which button the UI shows, so the safe default is "desktop is allowed" and
   * the hosted page remains the source of truth.
   */
  private async desktopAllowed(): Promise<boolean> {
    if (this.desktopAllowedCache !== null) {
      return this.desktopAllowedCache;
    }

    try {
      const workflow = await this.request<{ is_desktop_allowed?: boolean }>(
        "GET",
        `/v3/workflows/${encodeURIComponent(env.didit.workflowId)}/`,
      );

      this.desktopAllowedCache = workflow.is_desktop_allowed ?? true;
    } catch {
      this.desktopAllowedCache = true;
    }

    return this.desktopAllowedCache;
  }

  /**
   * US company registries are state-level, so Didit expects `US-CA` rather
   * than `US`. Falls back to the country when the state is unknown.
   */
  private registryCountry(state: string | null): string {
    return state ? `US-${state.toUpperCase()}` : "US";
  }

  private rejectLabels(response: DiditDecisionResponse): string[] {
    const labels = response.decision?.reject_labels;

    return Array.isArray(labels)
      ? labels.filter((label): label is string => typeof label === "string")
      : [];
  }

  private warnings(response: DiditDecisionResponse): string[] {
    const warnings = response.decision?.warnings;

    if (!Array.isArray(warnings)) {
      return [];
    }

    return warnings
      .map((warning) =>
        typeof warning === "string"
          ? warning
          : typeof warning?.risk === "string"
            ? warning.risk
            : null,
      )
      .filter((warning): warning is string => Boolean(warning));
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${env.didit.baseUrl}${path}`, {
        method,
        headers: {
          "x-api-key": env.didit.apiKey,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError(
        error instanceof Error && error.name === "TimeoutError"
          ? "Didit request timed out"
          : "Could not reach Didit",
        this.name,
      );
    }

    if (!response.ok) {
      /*
       * The provider's body can echo request data, so it never reaches the
       * client or the logs. The status is enough to diagnose a 401 vs a 429.
       */
      throw new ProviderError(
        `Didit responded with HTTP ${response.status}`,
        this.name,
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderError("Didit returned invalid JSON", this.name);
    }
  }
}
