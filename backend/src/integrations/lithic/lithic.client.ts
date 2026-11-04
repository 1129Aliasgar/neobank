/**
 * Lithic Sandbox adapter.
 *
 * The API changed under the original implementation: account holders live at
 * `/account_holders` (not `/cardholders`), a card is attached with
 * `account_token` (not `cardholder_token`), and card lifecycle states are
 * `OPEN` / `PAUSED` / `CLOSED`. This file is the only place raw Lithic shapes
 * are allowed to exist; the rest of the codebase speaks NeoBank's vocabulary.
 *
 * Sandbox simulation calls are deliberately isolated here so they can be
 * refused in production by a single guard.
 */

import { env } from "../../config/env.js";

export type LithicCardholderInput = {
  email: string;
  firstName: string;
  lastName: string;
  address: {
    address1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  phoneNumber?: string;
};

export type LithicAccountHolder = {
  token: string;
  account_token?: string;
  status?: string;
  status_reasons?: string[];
};

export type LithicCard = {
  token: string;
  account_token?: string;
  /** OPEN | PAUSED | CLOSED | PENDING_* */
  state?: string;
  type?: string;
  last_four?: string;
  /** Sandbox only; production requires PCI compliance. */
  pan?: string;
  cvv?: string;
  exp_month?: number | string;
  exp_year?: number | string;
  spend_limit?: number;
  spend_limit_duration?: string;
  memo?: string;
};

export type LithicAuthorization = {
  token: string;
  debugging_request_id?: string;
};

export class LithicUnavailableError extends Error {
  constructor(message = "Lithic card issuing is not configured") {
    super(message);
    this.name = "LithicUnavailableError";
  }
}

export class LithicSandboxUnavailableError extends Error {
  constructor(message = "Lithic simulation is only available in Sandbox") {
    super(message);
    this.name = "LithicSandboxUnavailableError";
  }
}

export default class LithicClient {
  private readonly baseUrl = env.lithic.baseUrl.replace(/\/$/, "");

  private ensureConfigured() {
    if (!env.lithic.enabled || !env.lithic.apiKey) {
      throw new LithicUnavailableError();
    }
  }

  private ensureSandbox() {
    this.ensureConfigured();
    if (env.lithic.environment !== "sandbox") {
      throw new LithicSandboxUnavailableError();
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.ensureConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: env.lithic.apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

      const body = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const detail =
          typeof body === "object" && body !== null && "message" in body
            ? String((body as { message: unknown }).message)
            : `Lithic request failed (${response.status})`;
        throw new Error(detail);
      }

      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * KYC_EXEMPT + AUTHORIZED_USER is the correct workflow for an employee who
   * is a card authorised user, not the business's beneficial owner. It was
   * verified against the Sandbox and needs no government id.
   */
  createAccountHolder(input: LithicCardholderInput) {
    return this.request<LithicAccountHolder>("/account_holders", {
      method: "POST",
      body: JSON.stringify({
        workflow: "KYC_EXEMPT",
        kyc_exemption_type: "AUTHORIZED_USER",
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        ...(input.phoneNumber ? { phone_number: input.phoneNumber } : {}),
        address: {
          address1: input.address.address1,
          city: input.address.city,
          state: input.address.state,
          postal_code: input.address.postalCode,
          country: input.address.country,
        },
      }),
    });
  }

  createVirtualCard(input: {
    accountToken: string;
    spendLimit?: number;
    spendLimitDuration?: string;
    memo?: string;
  }) {
    return this.request<LithicCard>("/cards", {
      method: "POST",
      body: JSON.stringify({
        type: "VIRTUAL",
        account_token: input.accountToken,
        state: "OPEN",
        ...(input.spendLimit === undefined
          ? {}
          : { spend_limit: input.spendLimit }),
        ...(input.spendLimitDuration
          ? { spend_limit_duration: input.spendLimitDuration }
          : {}),
        ...(input.memo ? { memo: input.memo.slice(0, 64) } : {}),
      }),
    });
  }

  retrieveCard(token: string) {
    return this.request<LithicCard>(`/cards/${encodeURIComponent(token)}`);
  }

  updateCard(token: string, state: "OPEN" | "PAUSED" | "CLOSED") {
    return this.request<LithicCard>(`/cards/${encodeURIComponent(token)}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
  }

  /** Sandbox-only: drive a real authorization through Lithic's simulator. */
  simulateAuthorization(input: {
    amount: number;
    descriptor: string;
    pan: string;
  }) {
    this.ensureSandbox();
    return this.request<LithicAuthorization>("/simulate/authorize", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Sandbox-only: settle an existing authorization. */
  simulateClearing(input: { amount: number; token: string }) {
    this.ensureSandbox();
    return this.request<{ debugging_request_id?: string }>(
      "/simulate/clearing",
      { method: "POST", body: JSON.stringify(input) },
    );
  }
}
