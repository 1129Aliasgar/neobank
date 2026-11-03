import { createHash } from "node:crypto";
import ApiError from "./apiError.js";
import { STATUS_CODE } from "../constants/constants.js";

export function parseMinor(input: unknown): bigint {
  if (typeof input !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(input)) {
    throw new ApiError(
      "amountMinor must be a positive integer string",
      STATUS_CODE.INPROCESSABLE_ENTITY,
    );
  }
  const [whole, fraction = ""] = input.split(".");
  const value = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (value <= 0n)
    throw new ApiError(
      "amountMinor must be positive",
      STATUS_CODE.INPROCESSABLE_ENTITY,
    );
  return value;
}

/** Parses the API amountMinor contract: an integer string already in cents. */
export function parseMinorUnits(input: unknown): bigint {
  if (typeof input !== "string" || !/^\d{1,15}$/.test(input)) {
    throw new ApiError(
      "amountMinor must be a positive integer string",
      STATUS_CODE.INPROCESSABLE_ENTITY,
    );
  }
  const value = BigInt(input);
  if (value <= BigInt(0))
    throw new ApiError(
      "amountMinor must be positive",
      STATUS_CODE.INPROCESSABLE_ENTITY,
    );
  return value;
}

export function hashRequest(value: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        out[key] = value[key];
        return out;
      }, {}),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function encodeCursor(postedAt: Date, id: string): string {
  return Buffer.from(`${postedAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(value: string): { postedAt: Date; id: string } {
  try {
    const [date, id] = Buffer.from(value, "base64url")
      .toString("utf8")
      .split("|");
    const postedAt = new Date(date);
    if (!id || Number.isNaN(postedAt.getTime())) throw new Error("invalid");
    return { postedAt, id };
  } catch {
    throw new ApiError("Invalid cursor", STATUS_CODE.INPROCESSABLE_ENTITY);
  }
}

export function jsonMoney(value: bigint): string {
  return value.toString();
}
