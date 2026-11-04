/**
 * Human labels for the two status vocabularies.
 *
 * The API's vocabulary is deliberately blunt (`REJECTED`, not "Declined"), and
 * the UI should not rearrange the meaning — only soften the register.
 */

import type { BusinessStatus } from "./auth";
import type { VerificationStatus } from "./business";

export type StatusTone =
  "neutral" | "progress" | "positive" | "negative" | "attention";

export function verificationLabel(status: VerificationStatus): string {
  switch (status) {
    case "NOT_STARTED":
      return "Not started";
    case "PENDING":
      return "In progress";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Declined";
    case "REVIEW":
      return "In review";
    default:
      return status;
  }
}

export function verificationTone(status: VerificationStatus): StatusTone {
  switch (status) {
    case "APPROVED":
      return "positive";
    case "REJECTED":
      return "negative";
    case "PENDING":
    case "REVIEW":
      return "progress";
    default:
      return "neutral";
  }
}

export function businessLabel(status: BusinessStatus): string {
  switch (status) {
    case "PENDING_VERIFICATION":
      return "Pending verification";
    case "ACTIVE":
      return "Active";
    case "REJECTED":
      return "Rejected";
    case "SUSPENDED":
      return "Suspended";
    case "CLOSED":
      return "Closed";
    default:
      return status;
  }
}

export function businessTone(status: BusinessStatus): StatusTone {
  switch (status) {
    case "ACTIVE":
      return "positive";
    case "PENDING_VERIFICATION":
      return "progress";
    case "REJECTED":
      return "negative";
    case "SUSPENDED":
      return "attention";
    default:
      return "neutral";
  }
}

/** "11:42 GMT, 3 November 2026" — UTC so two viewers see the same timestamp. */
export function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Sandbox scenario slugs come from the provider; keep them legible. */
export function scenarioLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
