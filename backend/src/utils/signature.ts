/**
 * HMAC helpers for provider webhooks.
 *
 * Didit signs every delivery with HMAC-SHA256 using the destination's
 * `secret_shared_key`, and sends three variants. We accept the two that cover
 * the body:
 *
 * - `X-Signature`      — the exact bytes we received. Strictest, preferred.
 * - `X-Signature-V2`   — canonical JSON (sorted keys, compact, Unicode kept).
 *                        Survives middleware re-encoding.
 *
 * `X-Signature-Simple` is not accepted: it authenticates four envelope fields
 * and says nothing about `decision`.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type HmacAlgorithm = "sha256" | "sha512" | "sha1";

export function hmacHex(
  secret: string,
  payload: string | Buffer,
  algorithm: HmacAlgorithm = "sha256",
): string {
  return createHmac(algorithm, secret).update(payload).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Length is compared first because `timingSafeEqual` throws on mismatched
 * buffers; leaking the length of a digest is not a meaningful oracle.
 */
export function timingSafeEqualHex(
  expected: string,
  received: string | undefined,
): boolean {
  if (!received) {
    return false;
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function shortenFloats(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(shortenFloats);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        shortenFloats(item),
      ]),
    );
  }

  /* Didit serialises whole-valued floats as ints. */
  if (typeof value === "number" && !Number.isInteger(value) && value % 1 === 0) {
    return Math.trunc(value);
  }

  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

/** Reproduces Didit's canonical JSON: sorted keys, compact separators. */
export function canonicalJson(parsed: unknown): string {
  return JSON.stringify(sortKeys(shortenFloats(parsed)));
}
