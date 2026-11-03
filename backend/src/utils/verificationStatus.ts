/**
 * Provider status → internal state, in one place.
 *
 * Both the webhook path and the polling fallback call this, so they cannot
 * disagree about what "Declined" means. The mapping is deliberately total: an
 * unknown string becomes REVIEW, never APPROVED.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import {
  BUSINESS_STATUS,
  VERIFICATION_STATUS,
  type BusinessStatus,
  type VerificationStatus,
} from "../constants/constants.js";

export interface StatusTransition {
  verificationStatus: VerificationStatus;
  /**
   * The business status this transition implies, or `null` when the business
   * must not move (abandoned/expired keep it pending and retryable).
   */
  businessStatus: BusinessStatus | null;
  actionRequired: boolean;
}

/** Didit statuses are case-sensitive on the wire but we normalise defensively. */
function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, " ");
}

/**
 * Maps a provider status string.
 *
 * `Abandoned` and `Expired` are not refusals: the user walked away or the link
 * timed out. They close the attempt as REJECTED (it did not pass) but leave the
 * business PENDING_VERIFICATION so a retry is the obvious next step.
 */
export function mapProviderStatus(raw: string): StatusTransition {
  switch (normalise(raw)) {
    case "not started":
      return {
        verificationStatus: VERIFICATION_STATUS.NOT_STARTED,
        businessStatus: BUSINESS_STATUS.PENDING_VERIFICATION,
        actionRequired: true,
      };

    case "in progress":
      return {
        verificationStatus: VERIFICATION_STATUS.PENDING,
        businessStatus: BUSINESS_STATUS.PENDING_VERIFICATION,
        actionRequired: false,
      };

    case "awaiting user":
    case "resubmitted":
      return {
        verificationStatus: VERIFICATION_STATUS.PENDING,
        businessStatus: BUSINESS_STATUS.PENDING_VERIFICATION,
        actionRequired: true,
      };

    case "in review":
      return {
        verificationStatus: VERIFICATION_STATUS.REVIEW,
        businessStatus: BUSINESS_STATUS.PENDING_VERIFICATION,
        actionRequired: false,
      };

    case "approved":
      return {
        verificationStatus: VERIFICATION_STATUS.APPROVED,
        businessStatus: BUSINESS_STATUS.ACTIVE,
        actionRequired: false,
      };

    case "declined":
      return {
        verificationStatus: VERIFICATION_STATUS.REJECTED,
        businessStatus: BUSINESS_STATUS.REJECTED,
        actionRequired: false,
      };

    case "abandoned":
    case "expired":
    case "kyc expired":
      return {
        verificationStatus: VERIFICATION_STATUS.REJECTED,
        businessStatus: BUSINESS_STATUS.PENDING_VERIFICATION,
        actionRequired: false,
      };

    default:
      /*
       * An unrecognised status is a fact we do not understand. Parking it in
       * REVIEW routes it to a human instead of guessing in the customer's
       * favour.
       */
      return {
        verificationStatus: VERIFICATION_STATUS.REVIEW,
        businessStatus: null,
        actionRequired: false,
      };
  }
}

/** True once the attempt will not change again on its own. */
export function isTerminal(status: VerificationStatus): boolean {
  return (
    status === VERIFICATION_STATUS.APPROVED ||
    status === VERIFICATION_STATUS.REJECTED
  );
}

/**
 * Whether a webhook may move `current` to `next`.
 *
 * Terminal states are sticky: a late "In Progress" must not un-approve a
 * business, and a second terminal answer is left for ops rather than silently
 * flipping the customer's status.
 */
export function canTransition(
  current: VerificationStatus,
  next: VerificationStatus,
): boolean {
  if (!isTerminal(current)) {
    return true;
  }

  return current === next;
}

export interface DecisionPlanInput {
  current: VerificationStatus;
  mapped: StatusTransition;
  businessStatus: BusinessStatus;
}

export interface DecisionPlan {
  /** False when the event is a duplicate or would break the state machine. */
  apply: boolean;
  verificationStatus: VerificationStatus;
  /** Null means "do not touch the business status". */
  businessStatus: BusinessStatus | null;
  actionRequired: boolean;
  /** Machine-readable reason for `apply: false`, safe to log. */
  reason:
    | "duplicate"
    | "terminal-conflict"
    | "stale-provider"
    | null;
}

/**
 * Decides what an incoming provider status may change.
 *
 * Kept separate from the database write so the webhook path, the polling path
 * and the sandbox simulator all answer this question identically — the bug
 * this prevents is one code path approving what another parked for review.
 */
export function planDecision(input: DecisionPlanInput): DecisionPlan {
  const { current, mapped, businessStatus } = input;

  if (current === mapped.verificationStatus) {
    return {
      apply: false,
      verificationStatus: current,
      businessStatus: null,
      actionRequired: mapped.actionRequired,
      reason: "duplicate",
    };
  }

  if (isTerminal(current)) {
    /*
     * Approval and rejection are absorbing states for an attempt. A different
     * terminal answer means the provider changed its mind after the fact;
     * that is an operator decision, not a webhook side effect.
     */
    return {
      apply: false,
      verificationStatus: current,
      businessStatus: null,
      actionRequired: false,
      reason: "terminal-conflict",
    };
  }

  /*
   * A provider read can briefly report `Not Started` for a session we already
   * watched progress — reopening the hosted link resets the provider's view.
   * Applying it would rewind the attempt and show the customer a fresh "start"
   * button mid-flow, so it is treated as a stale read instead.
   */
  if (
    mapped.verificationStatus === VERIFICATION_STATUS.NOT_STARTED &&
    (current === VERIFICATION_STATUS.PENDING ||
      current === VERIFICATION_STATUS.REVIEW)
  ) {
    return {
      apply: false,
      verificationStatus: current,
      businessStatus: null,
      actionRequired: false,
      reason: "stale-provider",
    };
  }

  /*
   * `SUSPENDED`/`CLOSED` are operator states. The attempt is still updated so
   * the audit trail is complete, but the business status is not resurrected.
   */
  if (
    businessStatus === BUSINESS_STATUS.SUSPENDED ||
    businessStatus === BUSINESS_STATUS.CLOSED
  ) {
    return {
      apply: true,
      verificationStatus: mapped.verificationStatus,
      businessStatus: null,
      actionRequired: mapped.actionRequired,
      reason: null,
    };
  }

  /*
   * A refusal that arrives after the business was already activated is the
   * same category as a late terminal event: store the verification outcome,
   * leave the activation for ops.
   */
  if (
    businessStatus === BUSINESS_STATUS.ACTIVE &&
    mapped.businessStatus !== null &&
    mapped.businessStatus !== BUSINESS_STATUS.ACTIVE
  ) {
    return {
      apply: true,
      verificationStatus: mapped.verificationStatus,
      businessStatus: null,
      actionRequired: mapped.actionRequired,
      reason: null,
    };
  }

  return {
    apply: true,
    verificationStatus: mapped.verificationStatus,
    businessStatus: mapped.businessStatus,
    actionRequired: mapped.actionRequired,
    reason: null,
  };
}
