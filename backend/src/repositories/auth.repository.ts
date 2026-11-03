/**
 * Persistence for the auth slice and the business membership it depends on.
 *
 * No business rules live here: the repository does not know who is calling, and
 * never hashes, compares or issues anything.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import { TYPES } from "../config/types.js";
import { DbClient } from "../types/database.types.js";
import type { CreateOwnerAccountInput } from "../types/business.types.js";
import {
  BUSINESS_STATUS,
  MEMBERSHIP_STATUS,
  USER_ROLE,
} from "../constants/constants.js";

/** The business fields embedded in auth responses. */
const BUSINESS_SUMMARY = {
  id: true,
  legalName: true,
  currency: true,
  status: true,
} as const;

@injectable()
export default class AuthRepository {
  private readonly db: DbClient;

  constructor(@inject(TYPES.PrismaClient) db: DbClient) {
    this.db = db;
  }

  /**
   * Registration is one transaction: a user without a business, or a business
   * without its OWNER, is a corrupt account. The unique indexes on email,
   * username and `(businessId, userId)` are what make concurrent sign-ups safe.
   */
  async createOwnerAccount(input: CreateOwnerAccountInput) {
    return await this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.user.username,
          email: input.user.email,
          password: input.user.password,
        },
      });

      const business = await tx.business.create({
        data: {
          legalName: input.business.legalName,
          country: input.business.country,
          status: BUSINESS_STATUS.PENDING_VERIFICATION,
        },
      });

      const membership = await tx.businessMember.create({
        data: {
          businessId: business.id,
          userId: user.id,
          role: USER_ROLE.OWNER,
          status: MEMBERSHIP_STATUS.ACTIVE,
          joinedAt: new Date(),
        },
      });

      return { user, business, membership };
    });
  }

  /**
   * `password` is omitted client-wide, so the login check has to opt back in
   * to it explicitly. Every other read of a user gets the hash-free shape.
   *
   * The newest active membership is the one the login token is scoped to. The
   * MVP has exactly one per user; the ordering makes multi-business behaviour
   * deterministic when that lands.
   */
  async findByEmail(email: string) {
    return await this.db.user.findUnique({
      where: { email },
      omit: { password: false },
      include: {
        memberships: {
          where: { status: MEMBERSHIP_STATUS.ACTIVE },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            business: { select: BUSINESS_SUMMARY },
          },
        },
      },
    });
  }

  async findByUsername(username: string) {
    return await this.db.user.findFirst({
      where: { username, isDeleted: false },
      select: { id: true },
    });
  }

  /** Profile read, scoped to the business the token was issued for. */
  async findProfile(userId: string, businessId: string) {
    return await this.db.businessMember.findFirst({
      where: {
        userId,
        businessId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        user: { isDeleted: false },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        business: { select: BUSINESS_SUMMARY },
      },
    });
  }

  /**
   * Minimal projection used by `authMiddleware` on every request. Returning the
   * membership rather than the user means a removed member loses access
   * immediately, without waiting for their token to expire.
   */
  async findSessionForAuthorization(userId: string, businessId: string) {
    return await this.db.businessMember.findFirst({
      where: {
        userId,
        businessId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        user: { isDeleted: false },
      },
      select: {
        role: true,
        user: {
          select: { id: true, tokenVersion: true, isDeleted: true },
        },
        business: {
          select: { id: true, status: true },
        },
      },
    });
  }

  async isTokenBlacklisted(token: string) {
    return await this.db.blacklistToken.findUnique({
      where: { token },
    });
  }

  async createToken(token: string, userId: string, expiresAt: Date) {
    return await this.db.blacklistToken.create({
      data: { token, userId, expiresAt },
    });
  }
}
