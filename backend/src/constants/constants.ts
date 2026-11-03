/**
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
  INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Business roles required by the Neobank track.
 *
 * - OWNER       registers the business, owns the account and the team
 * - ADMIN       manages the team, cards and payment approvals
 * - EMPLOYEE    uses an assigned card and initiates payment requests
 * - OPERATIONS  platform operator: reads webhooks / ledger / breaks, never money
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
