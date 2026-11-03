/**
 * Didit webhook parsing, signature verification and payload sanitising.
 *
 * Kept beside the HTTP client and away from the domain: the provider's wire
 * format changes on Didit's schedule, not ours.
 *
 * Signature rules (see `planning/feature0.md` §8.6):
 *
 *   1. `X-Timestamp` must be within ±300 s — replay defence.
 *   2. `X-Signature` = HMAC-SHA256 over the exact received bytes.
 *   3. `X-Signature-V2` = HMAC-SHA256 over canonical JSON.
 *   4. `-Previous` variants are accepted for the 24 h after a secret rotation.
 *   5. `X-Signature-Simple` is never accepted: it does not cover `decision`.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import {
  canonicalJson,
  hmacHex,
  timingSafeEqualHex,
} from "../../utils/signature.js";

const TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface DiditWebhookPayload {
  event_id?: string;
  webhook_type?: string;
  trigger?: string;
  timestamp?: number;
  created_at?: number;
  environment?: string;
  sandbox_scenario?: string | null;
  session_id?: string;
  session_kind?: string;
  status?: string;
  vendor_data?: string;
  decision?: {
    status?: string;
    reject_labels?: unknown;
    warnings?: unknown;
  };
}

export type SignatureFailure = "missing-timestamp" | "stale-timestamp" | "bad-signature";

export interface SignatureResult {
  ok: boolean;
  reason?: SignatureFailure;
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

/**
 * `X-Signature` covers the bytes; `X-Signature-V2` covers a canonical form that
 * survives re-encoding. Both are tried, and a match on either is sufficient.
 */
export function verifyDiditSignature(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
): SignatureResult {
  const timestamp = header(headers, "x-timestamp");

  if (!timestamp) {
    return { ok: false, reason: "missing-timestamp" };
  }

  const dispatchedAt = Number(timestamp);

  if (!Number.isFinite(dispatchedAt)) {
    return { ok: false, reason: "missing-timestamp" };
  }

  const drift = Math.abs(Math.floor(Date.now() / 1000) - dispatchedAt);

  if (drift > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale-timestamp" };
  }

  const rawCandidates = [
    header(headers, "x-signature"),
    header(headers, "x-signature-previous"),
  ].filter((value): value is string => Boolean(value));

  const expectedRaw = hmacHex(env.didit.webhookSecret, rawBody);

  if (rawCandidates.some((candidate) => timingSafeEqualHex(expectedRaw, candidate))) {
    return { ok: true };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { ok: false, reason: "bad-signature" };
  }

  const v2Candidates = [
    header(headers, "x-signature-v2"),
    header(headers, "x-signature-v2-previous"),
  ].filter((value): value is string => Boolean(value));

  const expectedV2 = hmacHex(env.didit.webhookSecret, canonicalJson(parsed));

  if (v2Candidates.some((candidate) => timingSafeEqualHex(expectedV2, candidate))) {
    return { ok: true };
  }

  return { ok: false, reason: "bad-signature" };
}

/**
 * `event_id` is the idempotency key. The fallback hash is only a safety net for
 * a malformed v3 delivery; it is stable for a redelivery of the same event.
 */
export function webhookEventId(
  payload: DiditWebhookPayload,
  rawBody: Buffer,
): string {
  if (typeof payload.event_id === "string" && payload.event_id.trim()) {
    return payload.event_id.trim();
  }

  return createHash("sha256")
    .update(
      [
        payload.session_id ?? "",
        payload.status ?? "",
        payload.webhook_type ?? "",
        payload.created_at ?? "",
      ].join("|"),
    )
    .digest("hex");
}

/** Provider `created_at`, in seconds, as a `Date` for ordering. */
export function webhookCreatedAt(
  payload: DiditWebhookPayload,
): Date | null {
  const seconds = payload.created_at ?? payload.timestamp;

  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000)
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item !== null && typeof item === "object") {
        const risk = (item as { risk?: unknown }).risk;

        return typeof risk === "string" ? risk : null;
      }

      return null;
    })
    .filter((item): item is string => Boolean(item));
}

/**
 * The stored payload is a status notification, not a data store: names,
 * emails, phones, addresses, documents and UBO data are dropped, as is the
 * whole `metadata` object (it can carry customer-supplied values).
 */
export function sanitiseDiditPayload(
  payload: DiditWebhookPayload,
): Prisma.InputJsonObject {
  const decision = payload.decision;

  return {
    event_id: payload.event_id ?? null,
    webhook_type: payload.webhook_type ?? null,
    trigger: payload.trigger ?? null,
    timestamp: payload.timestamp ?? null,
    created_at: payload.created_at ?? null,
    environment: payload.environment ?? null,
    sandbox_scenario: payload.sandbox_scenario ?? null,
    session_id: payload.session_id ?? null,
    session_kind: payload.session_kind ?? null,
    status: payload.status ?? null,
    vendor_data: payload.vendor_data ?? null,
    decision: {
      status: decision?.status ?? null,
      reject_labels: stringArray(decision?.reject_labels),
      warnings: stringArray(decision?.warnings),
    },
  };
}

/** Reject labels and warnings, extracted once for both storage paths. */
export function decisionDetail(payload: DiditWebhookPayload): {
  rejectLabels: string[];
  warnings: string[];
} {
  return {
    rejectLabels: stringArray(payload.decision?.reject_labels),
    warnings: stringArray(payload.decision?.warnings),
  };
}
