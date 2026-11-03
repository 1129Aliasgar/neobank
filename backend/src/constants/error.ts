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

export const WEBHOOK_ERRORS = {
  INVALID_SIGNATURE: "Invalid webhook signature",
  STALE_TIMESTAMP: "Webhook timestamp is outside the accepted window",
  MALFORMED_PAYLOAD: "Malformed webhook payload",
} as const;
