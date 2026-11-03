/**
 * Authentication and authorisation for every protected route.
 *
 * The token is only a claim. On each request the middleware re-reads the
 * membership, so removing a member, changing their role, bumping
 * `tokenVersion`, suspending the business or blacklisting the token all take
 * effect immediately rather than when the JWT happens to expire.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import type { NextFunction, Request, Response } from "express";
import {
  ALL_USER_ROLES,
  BUSINESS_STATUS,
  STATUS_CODE,
} from "../constants/constants.js";
import type { UserRole } from "../constants/constants.js";
import { AUTH_ERRORS } from "../constants/error.js";
import container from "../config/container.js";
import { TYPES } from "../config/types.js";
import type AuthRepository from "../repositories/auth.repository.js";
import { setRequestUserId } from "../utils/requestContext.js";
import { verifyToken } from "../utils/token.js";
import { extractToken } from "../utils/authCookie.js";

type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    businessId: string;
    role: UserRole;
  };
};

export const authMiddleware = (
  roles: UserRole | readonly UserRole[] = ALL_USER_ROLES,
) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    /*
     * The `__Host-` cookie (plain name in dev) or a Bearer token. The legacy
     * `token` cookie is never read: accepting it would let a sibling subdomain
     * plant a second value and reintroduce cookie tossing.
     */
    const token = extractToken(req);

    if (!token) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: AUTH_ERRORS.REQUIRED });
    }

    let decoded;

    try {
      decoded = verifyToken(token);
    } catch {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: AUTH_ERRORS.INVALID_TOKEN });
    }

    try {
      const authRepository = container.get<AuthRepository>(
        TYPES.AuthRepository,
      );
      const [session, blacklistedToken] = await Promise.all([
        authRepository.findSessionForAuthorization(
          decoded.userId,
          decoded.businessId,
        ),
        authRepository.isTokenBlacklisted(token),
      ]);

      /*
       * No session means: no such membership, the membership was removed, or
       * the user was soft-deleted. All are token-invalid, not "forbidden" —
       * the client should sign in again.
       */
      if (!session) {
        return res
          .status(STATUS_CODE.UNAUTHORIZED)
          .json({ message: AUTH_ERRORS.INVALID_TOKEN });
      }

      if (session.user.isDeleted) {
        return res
          .status(STATUS_CODE.FORBIDDEN)
          .json({ message: AUTH_ERRORS.ACCOUNT_DELETED });
      }

      if (
        blacklistedToken ||
        session.user.tokenVersion !== decoded.tokenVersion ||
        session.role !== decoded.userRole
      ) {
        return res
          .status(STATUS_CODE.UNAUTHORIZED)
          .json({ message: AUTH_ERRORS.INVALID_TOKEN });
      }

      /*
       * Suspended/closed businesses keep read access to nothing: compliance
       * suspension freezes the whole workspace. PENDING_VERIFICATION is allowed
       * so a new business can finish onboarding; money-moving routes add their
       * own ACTIVE check.
       */
      if (
        session.business.status === BUSINESS_STATUS.SUSPENDED ||
        session.business.status === BUSINESS_STATUS.CLOSED
      ) {
        return res
          .status(STATUS_CODE.FORBIDDEN)
          .json({ message: AUTH_ERRORS.BUSINESS_UNAVAILABLE });
      }

      if (!allowedRoles.includes(session.role)) {
        return res
          .status(STATUS_CODE.FORBIDDEN)
          .json({ message: AUTH_ERRORS.FORBIDDEN });
      }

      req.user = {
        userId: session.user.id,
        businessId: session.business.id,
        role: session.role,
      };
      setRequestUserId(session.user.id);

      return next();
    } catch (error) {
      return next(error);
    }
  };
};
