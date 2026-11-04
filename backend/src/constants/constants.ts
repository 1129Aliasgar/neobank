/**
 * Domain vocabulary shared by services, validators and the API layer.
 *
 * These objects mirror the Prisma enums. They exist so a service can compare
 * against `BUSINESS_STATUS.ACTIVE` instead of a loose string, and so the
 * compiler catches a typo in a state transition.
 *
 * @author aliasgarbootwala3@gmail.com
 */

export const STATUS_CODE = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Business roles required by the Neobank track.
 *
 * - OWNER       registers the business, owns the account and the team
 * - ADMIN       manages the team, cards and payment approvals
 * - EMPLOYEE    uses an assigned card and initiates payment requests
 * - OPERATIONS  platform operator: reads webhooks / ledger / breaks, never money
 *
 * Public registration always creates an OWNER. There is no "business" role:
 * the business is the tenant, not a permission level, and the first person in
 * it owns it. Adding a fifth role would add a branch to every authorisation
 * check without modelling anything the four cannot express.
 *
 * The initiator/approver split is a permission check, not a role of its own:
 * any OWNER or ADMIN can approve, except the person who made the request.
 */
export const USER_ROLE = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  EMPLOYEE: "EMPLOYEE",
  OPERATIONS: "OPERATIONS",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const USER_ROLES: UserRole[] = Object.values(USER_ROLE);

export const ALL_USER_ROLES: UserRole[] = [...USER_ROLES];

/** Roles that belong to a customer business and may move money. */
export const BUSINESS_ROLES: UserRole[] = [
  USER_ROLE.OWNER,
  USER_ROLE.ADMIN,
  USER_ROLE.EMPLOYEE,
];

/** Roles allowed to approve another person's payment above the threshold. */
export const APPROVER_ROLES: UserRole[] = [USER_ROLE.OWNER, USER_ROLE.ADMIN];

/** Roles an invitation or a role change may grant. Ownership is never invited. */
export const INVITABLE_ROLES: UserRole[] = [
  USER_ROLE.EMPLOYEE,
  USER_ROLE.ADMIN,
];

/**
 * Documented ceiling for the approval threshold: $1,000,000,000.00.
 * A larger value is a configuration mistake, not a policy choice.
 */
export const MAX_APPROVAL_THRESHOLD_MINOR = BigInt("100000000000");

/** Invitation links live for seven days, then require a resend. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITATION_STATUS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
} as const;

export const PAYMENT_REQUEST_STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  CANCELED: "CANCELED",
  FAILED: "FAILED",
} as const;

export const APPROVAL_DECISION = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

/** Roles allowed to change the business profile and start a KYB check. */
export const BUSINESS_ADMIN_ROLES: UserRole[] = [
  USER_ROLE.OWNER,
  USER_ROLE.ADMIN,
];

/**
 * Business lifecycle. Only `ACTIVE` may open accounts, issue cards or move
 * money; `SUSPENDED` is a reversible compliance hold.
 */
export const BUSINESS_STATUS = {
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  ACTIVE: "ACTIVE",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
} as const;

export type BusinessStatus =
  (typeof BUSINESS_STATUS)[keyof typeof BUSINESS_STATUS];

export const BUSINESS_TYPE = {
  LLC: "LLC",
  CORPORATION: "CORPORATION",
  PARTNERSHIP: "PARTNERSHIP",
  SOLE_PROPRIETORSHIP: "SOLE_PROPRIETORSHIP",
} as const;

export type BusinessType = (typeof BUSINESS_TYPE)[keyof typeof BUSINESS_TYPE];

export const BUSINESS_TYPES: BusinessType[] = Object.values(BUSINESS_TYPE);

export const MEMBERSHIP_STATUS = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export type MembershipStatus =
  (typeof MEMBERSHIP_STATUS)[keyof typeof MEMBERSHIP_STATUS];

/**
 * Verification attempt state. Five values, deliberately: the API and the UI
 * only reason about these, and the provider's raw string is stored separately.
 */
export const VERIFICATION_STATUS = {
  NOT_STARTED: "NOT_STARTED",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  REVIEW: "REVIEW",
} as const;

export type VerificationStatus =
  (typeof VERIFICATION_STATUS)[keyof typeof VERIFICATION_STATUS];

/** Statuses during which a business may not start a second attempt. */
export const ACTIVE_VERIFICATION_STATUSES: VerificationStatus[] = [
  VERIFICATION_STATUS.NOT_STARTED,
  VERIFICATION_STATUS.PENDING,
  VERIFICATION_STATUS.REVIEW,
];

export const VERIFICATION_ENVIRONMENT = {
  SANDBOX: "SANDBOX",
  LIVE: "LIVE",
} as const;

export type VerificationEnvironment =
  (typeof VERIFICATION_ENVIRONMENT)[keyof typeof VERIFICATION_ENVIRONMENT];

/**
 * What the onboarding UI should do next.
 *
 * Derived on every read from profile completeness + the latest attempt +
 * business status. Never stored: a stored copy is a second source of truth
 * that drifts the first time a webhook lands out of order.
 */
export const ONBOARDING_STEP = {
  COMPLETE_PROFILE: "COMPLETE_PROFILE",
  START_VERIFICATION: "START_VERIFICATION",
  OPEN_VERIFICATION: "OPEN_VERIFICATION",
  WAIT_FOR_REVIEW: "WAIT_FOR_REVIEW",
  RETURN_TO_PROVIDER: "RETURN_TO_PROVIDER",
  FIX_AND_RETRY: "FIX_AND_RETRY",
  DONE: "DONE",
  CONTACT_SUPPORT: "CONTACT_SUPPORT",
} as const;

export type OnboardingStep =
  (typeof ONBOARDING_STEP)[keyof typeof ONBOARDING_STEP];

/** Who caused an audited action. Mirrors the Prisma enum. */
export const AUDIT_ACTOR_TYPE = {
  USER: "USER",
  SYSTEM: "SYSTEM",
  AGENT: "AGENT",
} as const;

export type AuditActorType =
  (typeof AUDIT_ACTOR_TYPE)[keyof typeof AUDIT_ACTOR_TYPE];

/**
 * Provider that produced an attempt. `SIMULATOR` is the labelled dev-only
 * fallback: an approval it returns can never be mistaken for a real decision.
 */
export const VERIFICATION_PROVIDER = {
  DIDIT: "DIDIT",
  SIMULATOR: "SIMULATOR",
  SUMSUB: "SUMSUB",
} as const;

export type VerificationProvider =
  (typeof VERIFICATION_PROVIDER)[keyof typeof VERIFICATION_PROVIDER];

/** Sessions/tickets that a provider can still act on. */
export const WEBHOOK_STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
} as const;

/** Audit actions written by Module 1. Strings stay stable across releases. */
export const AUDIT_ACTION = {
  BUSINESS_PROFILE_UPDATED: "BUSINESS_PROFILE_UPDATED",
  VERIFICATION_STARTED: "VERIFICATION_STARTED",
  VERIFICATION_STATUS_CHANGED: "VERIFICATION_STATUS_CHANGED",
  ACCOUNT_OPENED: "ACCOUNT_OPENED",
  FUNDS_ADDED: "FUNDS_ADDED",
  HOLD_CREATED: "HOLD_CREATED",
  HOLD_CAPTURED: "HOLD_CAPTURED",
  HOLD_RELEASED: "HOLD_RELEASED",
  TRANSACTION_REVERSED: "TRANSACTION_REVERSED",
  TEAM_INVITATION_CREATED: "TEAM_INVITATION_CREATED",
  TEAM_INVITATION_RESENT: "TEAM_INVITATION_RESENT",
  TEAM_INVITATION_REVOKED: "TEAM_INVITATION_REVOKED",
  TEAM_INVITATION_ACCEPTED: "TEAM_INVITATION_ACCEPTED",
  TEAM_ROLE_CHANGED: "TEAM_ROLE_CHANGED",
  TEAM_MEMBER_DISABLED: "TEAM_MEMBER_DISABLED",
  APPROVAL_POLICY_UPDATED: "APPROVAL_POLICY_UPDATED",
  PAYMENT_REQUEST_CREATED: "PAYMENT_REQUEST_CREATED",
  PAYMENT_REQUEST_APPROVED: "PAYMENT_REQUEST_APPROVED",
  PAYMENT_REQUEST_REJECTED: "PAYMENT_REQUEST_REJECTED",
  PAYMENT_REQUEST_CANCELED: "PAYMENT_REQUEST_CANCELED",
  PAYMENT_REQUEST_POSTED: "PAYMENT_REQUEST_POSTED",
  PAYMENT_REQUEST_FAILED: "PAYMENT_REQUEST_FAILED",
} as const;

export const ACCOUNT_STATUS = { ACTIVE: "ACTIVE", FROZEN: "FROZEN", CLOSED: "CLOSED" } as const;
export const LEDGER_DIRECTION = { DEBIT: "DEBIT", CREDIT: "CREDIT" } as const;

export type WebhookStatus =
  (typeof WEBHOOK_STATUS)[keyof typeof WEBHOOK_STATUS];

/**
 * The auth cookie name.
 *
 * In production the `__Host-` prefix is used: the browser refuses to accept
 * such a cookie unless it is `Secure`, `Path=/` and has no `Domain` attribute.
 * That is the defence against **cookie tossing** — a sibling subdomain cannot
 * overwrite it with `Domain=.example.com`, because the prefix makes the
 * injection invalid and the browser keeps the host-only cookie.
 */
export const AUTH_COOKIE_NAME = "__Host-neobank_token";
export const AUTH_COOKIE_NAME_DEV = "neobank_token";
/** Legacy name kept only so logout can actively clear it. */
export const LEGACY_AUTH_COOKIE_NAME = "token";
