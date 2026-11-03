/**
 * Business-domain types.
 *
 * The Prisma models are the source of truth; these interfaces are what the
 * service and controller layers see so they do not depend on generated code.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type {
  BusinessStatus,
  MembershipStatus,
  UserRole,
} from "../constants/constants.js";

/** The slice of a business that is safe to embed in an auth response. */
export interface BusinessSummary {
  id: string;
  legalName: string;
  currency: string;
  status: BusinessStatus;
}

/**
 * A user's relationship to a business. `role` and `status` are membership
 * fields, never user fields.
 */
export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: UserRole;
  status: MembershipStatus;
  joinedAt: Date | null;
}

/** Everything the registration transaction writes. */
export interface CreateOwnerAccountInput {
  user: {
    username: string;
    email: string;
    password: string;
  };
  business: {
    legalName: string;
    country: string;
  };
}
