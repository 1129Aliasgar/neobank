/**
 * Centralized user-facing error messages.
 *
 * Controllers, services and middleware throw/report messages from here instead
 * of hard-coding strings, so wording stays consistent and can be changed in one
 * place.
 *
 * @author aliasgarbootwala3@gmail.com
 */

export const COMMON_ERRORS = {
  INTERNAL_SERVER_ERROR: "Something went wrong",
  VALIDATION_FAILED: "Invalid request",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "You are not allowed to access this resource",
  NOT_FOUND: "Resource not found",
} as const;

export const USER_ERRORS = {
  EMAIL_ALREADY_EXISTS: "This email is already registered",
  USERNAME_ALREADY_EXISTS: "Username is already taken",
  NOT_FOUND: "User not found",
  ACCOUNT_DELETED: "This account has been deleted",
  REGISTRATION_FAILED: "Something went wrong while registering",
} as const;

export const AUTH_ERRORS = {
  REQUIRED: "Authentication required",
  INVALID_TOKEN: "Invalid token",
  INVALID_PASSWORD: "Invalid password",
  TOKEN_INVALID: "Token is not valid",
  TOKEN_ALREADY_BLACKLISTED: "Token is already blacklisted",
  ACCOUNT_DELETED: "This account has been deleted",
  FORBIDDEN: "You are not allowed to access this resource",
  NO_MEMBERSHIP: "This account has no active business membership",
  BUSINESS_UNAVAILABLE: "This business account is not available",
} as const;

export const BUSINESS_ERRORS = {
  NOT_FOUND: "Business not found",
  NOT_EDITABLE: "This business can no longer be edited",
  IDENTITY_LOCKED:
    "Legal name, business type and registration number cannot change after verification",
  PROFILE_INCOMPLETE: "Complete the business profile before starting verification",
  ALREADY_VERIFIED: "This business is already verified",
} as const;

export const VERIFICATION_ERRORS = {
  IN_REVIEW: "This verification is still under review",
  NOT_ACTIVE: "There is no active verification to resume",
  ALREADY_ACTIVE: "A verification is already in progress",
  PROVIDER_UNAVAILABLE:
    "The verification provider is unavailable. Please try again.",
  SIMULATOR_DISABLED: "The verification simulator is not enabled",
  UNKNOWN_TRANSITION: "This verification update cannot be applied",
} as const;

export const LEDGER_ERRORS = {
  BUSINESS_NOT_ACTIVE: "Business is not active",
  EMPLOYEE_BALANCE_FORBIDDEN: "Employees cannot access the business wallet",
  ACCOUNT_NOT_ACTIVE: "Account is not active",
  IDEMPOTENCY_KEY_REQUIRED: "Idempotency-Key header is required",
  IDEMPOTENCY_KEY_REUSED: "Idempotency key was reused with a different request",
  AMOUNT_LIMIT_EXCEEDED: "Amount exceeds the per-call limit",
  FUNDING_LIMIT_EXCEEDED: "Daily sandbox funding limit exceeded",
  INSUFFICIENT_FUNDS: "Insufficient available funds",
  HOLD_NOT_ACTIVE: "Hold is no longer active",
  CAPTURE_EXCEEDS_HOLD: "Capture exceeds the hold amount",
  TRANSACTION_NOT_FOUND: "Transaction not found",
  REVERSAL_OF_REVERSAL: "A reversal cannot be reversed",
  ALREADY_REVERSED: "Transaction has already been reversed",
  OPERATIONS_ONLY: "This action requires the operations role",
  SANDBOX_DISABLED: "Sandbox ledger tools are disabled",
} as const;

export const TEAM_ERRORS = {
  FORBIDDEN: "Only an owner or admin can manage the team",
  OWNER_ONLY: "Only the business owner can do this",
  INVITATION_INVALID: "This invitation link is no longer valid",
  INVITATION_EMAIL_IN_USE:
    "This email already belongs to another business and cannot be invited here",
  INVITATION_EMAIL_DELETED:
    "This email belongs to a deleted account and cannot be invited",
  INVITATION_ALREADY_MEMBER: "This person is already a member of the business",
  INVITATION_NOT_PENDING: "This invitation is no longer pending",
  INVITATION_EMAIL_REGISTERED:
    "An account already exists for this email. Sign in and accept the invitation instead.",
  INVITATION_EMAIL_MISMATCH:
    "Sign in with the email address this invitation was sent to",
  INVITATION_OTHER_BUSINESS:
    "This account already belongs to another business. A sign-in is scoped to one business.",
  INVITATION_BUSINESS_UNAVAILABLE: "This business is not available",
  MEMBER_NOT_FOUND: "Team member not found",
  MEMBER_NOT_ACTIVE: "This membership is not active",
  MEMBER_DISABLED:
    "This person's membership is disabled and cannot be re-invited",
  SELF_ROLE_CHANGE: "You cannot change your own role",
  OWNER_ROLE_LOCKED: "The business owner cannot be demoted or disabled",
  SELF_DISABLE: "You cannot disable your own membership",
  THRESHOLD_TOO_LARGE: "Approval threshold exceeds the documented maximum",
  THRESHOLD_INVALID: "Approval threshold must be a non-negative integer string",
} as const;

export const PAYMENT_ERRORS = {
  BUSINESS_NOT_ACTIVE: "Business must be active before creating payments",
  NOT_FOUND: "Payment request not found",
  SELF_APPROVAL_FORBIDDEN: "You cannot approve your own payment request",
  APPROVER_ROLE_REQUIRED:
    "Only an owner or admin can approve or reject a payment",
  ALREADY_DECIDED: "This payment request has already been decided",
  INSUFFICIENT_FUNDS: "Insufficient available funds for this payment",
  AMOUNT_INVALID: "Enter a valid positive amount in minor units",
  AMOUNT_TOO_LARGE: "Amount exceeds the maximum single payment",
  BENEFICIARY_INVALID:
    "Beneficiary name must be between 1 and 120 characters",
  IDEMPOTENCY_INVALID:
    "Idempotency-Key must be 1-64 letters, numbers, colons, underscores or dashes",
  CANCEL_FORBIDDEN: "Only the person who created the request can cancel it",
  AGENT_FORBIDDEN: "Only a human user can decide a payment request",
  ACCOUNT_NOT_ACTIVE: "Account is not active",
} as const;

export const WEBHOOK_ERRORS = {
  INVALID_SIGNATURE: "Invalid webhook signature",
  STALE_TIMESTAMP: "Webhook timestamp is outside the accepted window",
  MALFORMED_PAYLOAD: "Malformed webhook payload",
} as const;

export const CARD_ERRORS = {
  PROVIDER_UNAVAILABLE: "Card issuing is temporarily unavailable",
  BUSINESS_NOT_ACTIVE: "Business must be active before issuing cards",
  EMPLOYEE_REQUIRED: "Cards can only be issued to active employees",
  CARDHOLDER_NOT_FOUND: "Cardholder not found",
  CARD_NOT_FOUND: "Card not found",
  CARD_NOT_ACTIVE: "Card is not active",
  INVALID_LIMIT: "Spending limit must be a positive amount in cents",
  INVALID_INTERVAL:
    "Spending limit interval must be ANNUALLY, FOREVER, MONTHLY or TRANSACTION",
  CARDHOLDER_ACCOUNT_MISSING:
    "Cardholder has no Lithic account token; retry cardholder creation",
  SANDBOX_ONLY: "Card simulation is only available in Lithic Sandbox",
  AUTHORIZATION_NOT_FOUND: "Card authorization not found",
  INSUFFICIENT_FUNDS: "Authorization declined: insufficient available funds",
} as const;
