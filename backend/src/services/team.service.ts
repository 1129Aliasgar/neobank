/**
 * Team, invitations, roles and the approval policy.
 *
 * The service owns every rule the database must not guess: who may invite,
 * which role an invitation can grant, how a one-time token is hashed, and how
 * a disabled member loses their existing JWT. Money never moves here; the
 * payment service owns that and calls `LedgerService`.
 *
 * @author aliasgarbootwala3@gmail.com
 */

import { inject, injectable } from "inversify";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { TYPES } from "../config/types.js";
import type { DbClient } from "../types/database.types.js";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import {
  AUDIT_ACTION,
  BUSINESS_STATUS,
  INVITABLE_ROLES,
  INVITATION_STATUS,
  INVITATION_TTL_MS,
  MAX_APPROVAL_THRESHOLD_MINOR,
  MEMBERSHIP_STATUS,
  STATUS_CODE,
  USER_ROLE,
  type UserRole,
} from "../constants/constants.js";
import {
  BUSINESS_ERRORS,
  TEAM_ERRORS,
  USER_ERRORS,
} from "../constants/error.js";
import ApiError from "../utils/apiError.js";
import { auditEntry } from "../utils/audit.js";
import { generateToken } from "../utils/token.js";
import { isUniqueConstraintViolation } from "../utils/prismaError.js";

type Tx = Prisma.TransactionClient;

type InvitationInput = {
  email: string;
  role: string;
};

/*
 * Only the threshold is settable through the API. `requireSeparateApprover` is
 * a stored guardrail, not a feature flag; exposing it here would let an owner
 * appear to switch maker-checker off even though self-approval stays refused.
 */
type ApprovalPolicyInput = {
  approvalThresholdMinor?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

function invitationLink(raw: string): string {
  return `${env.frontendUrl.replace(/\/$/, "")}/dashboard/invite/${raw}`;
}

function assertOperator(role: UserRole) {
  if (role !== USER_ROLE.OWNER && role !== USER_ROLE.ADMIN)
    throw new ApiError(TEAM_ERRORS.FORBIDDEN, STATUS_CODE.FORBIDDEN);
}

function assertOwner(role: UserRole) {
  if (role !== USER_ROLE.OWNER)
    throw new ApiError(TEAM_ERRORS.OWNER_ONLY, STATUS_CODE.FORBIDDEN);
}

function assertInvitable(role: string) {
  if (!INVITABLE_ROLES.includes(role as UserRole))
    throw new ApiError(
      "Invitations and role changes may only grant EMPLOYEE or ADMIN",
      STATUS_CODE.BAD_REQUEST,
    );
}

function thresholdClass(minor: bigint): string {
  if (minor === 0n) return "ZERO";
  if (minor < BigInt(10_000)) return "UNDER_100";
  if (minor < BigInt(100_000)) return "UNDER_1000";
  if (minor < BigInt(10_000_000)) return "UNDER_100K";
  return "AT_LEAST_100K";
}

const MEMBER_SELECT = {
  id: true,
  businessId: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      username: true,
      email: true,
      isDeleted: true,
    },
  },
} as const;

@injectable()
export default class TeamService {
  constructor(@inject(TYPES.PrismaClient) private readonly db: DbClient) {}

  private async business(tx: Tx, businessId: string) {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        legalName: true,
        currency: true,
        status: true,
        approvalThresholdMinor: true,
        requireSeparateApprover: true,
      },
    });

    if (!business) throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, 404);
    if (
      business.status === BUSINESS_STATUS.SUSPENDED ||
      business.status === BUSINESS_STATUS.CLOSED
    ) {
      throw new ApiError(
        TEAM_ERRORS.INVITATION_BUSINESS_UNAVAILABLE,
        STATUS_CODE.CONFLICT,
      );
    }

    return business;
  }

  private memberView(
    member: {
      id: string;
      businessId: string;
      userId: string;
      role: UserRole;
      status: string;
      joinedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      user: {
        id: string;
        username: string;
        email: string;
        isDeleted: boolean;
      };
    },
    actorUserId: string,
  ) {
    return {
      id: member.id,
      businessId: member.businessId,
      userId: member.userId,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      isYou: member.userId === actorUserId,
      user: member.user,
    };
  }

  private invitationView(invitation: {
    id: string;
    email: string;
    role: UserRole;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    invitedByUserId: string;
    acceptedAt: Date | null;
  }) {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitedByUserId: invitation.invitedByUserId,
      acceptedAt: invitation.acceptedAt,
    };
  }

  private policyView(business: {
    currency: string;
    approvalThresholdMinor: bigint;
    requireSeparateApprover: boolean;
  }) {
    return {
      approvalThresholdMinor: business.approvalThresholdMinor.toString(),
      requireSeparateApprover: business.requireSeparateApprover,
      maxApprovalThresholdMinor: MAX_APPROVAL_THRESHOLD_MINOR.toString(),
      currency: business.currency,
      /// The simulator never sends a real bank transfer; the UI states this.
      paymentRail: { driver: "SIMULATOR", simulated: true },
    };
  }

  /** Team page: every membership, every live invitation and the policy. */
  async list(actorUserId: string, businessId: string, role: UserRole) {
    assertOperator(role);

    /* Expiry is derived on read, so an abandoned link cannot look live. */
    await this.db.invitation.updateMany({
      where: {
        businessId,
        status: INVITATION_STATUS.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: INVITATION_STATUS.EXPIRED },
    });

    const [business, members, invitations] = await Promise.all([
      this.db.business.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          legalName: true,
          currency: true,
          status: true,
          approvalThresholdMinor: true,
          requireSeparateApprover: true,
        },
      }),
      this.db.businessMember.findMany({
        where: { businessId },
        orderBy: [{ createdAt: "asc" }],
        select: MEMBER_SELECT,
      }),
      this.db.invitation.findMany({
        where: { businessId, status: INVITATION_STATUS.PENDING },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          invitedByUserId: true,
          acceptedAt: true,
        },
      }),
    ]);

    if (!business) throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, 404);

    return {
      business: {
        id: business.id,
        legalName: business.legalName,
        currency: business.currency,
        status: business.status,
      },
      members: members.map((member) => this.memberView(member, actorUserId)),
      invitations: invitations.map((invitation) =>
        this.invitationView(invitation),
      ),
      policy: this.policyView(business),
      canManageMembers: role === USER_ROLE.OWNER,
      canInvite: true,
    };
  }

  /**
   * Create or replace a pending invitation.
   *
   * One live link per email: the previous PENDING row is revoked inside the
   * same transaction, and the partial unique index in the migration is the
   * final guard against two concurrent inviters.
   */
  async invite(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    input: InvitationInput,
  ) {
    assertOperator(role);
    assertInvitable(input.role);

    const email = normalizeEmail(input.email);
    const token = newToken();

    try {
      const invitation = await this.db.$transaction(async (tx) => {
        await this.business(tx, businessId);

        const existingMember = await tx.businessMember.findFirst({
          where: {
            businessId,
            user: { email },
          },
          select: { id: true, status: true },
        });
        if (existingMember?.status === MEMBERSHIP_STATUS.ACTIVE)
          throw new ApiError(
            TEAM_ERRORS.INVITATION_ALREADY_MEMBER,
            STATUS_CODE.CONFLICT,
          );
        /*
         * `DISABLED` is terminal for this module: the person has no active
         * membership, so login refuses and an invitation link would be a dead
         * end. Refuse at invite time instead of minting an unusable token.
         */
        if (existingMember?.status === MEMBERSHIP_STATUS.DISABLED)
          throw new ApiError(TEAM_ERRORS.MEMBER_DISABLED, STATUS_CODE.CONFLICT);

        /*
         * A sign-in is scoped to one business. An existing active member of a
         * different business cannot accept without an ambiguous session, so
         * the invitation is refused before it becomes a dead link.
         */
        const existingUser = await tx.user.findUnique({
          where: { email },
          select: {
            id: true,
            isDeleted: true,
            memberships: {
              where: { status: MEMBERSHIP_STATUS.ACTIVE },
              select: { businessId: true },
            },
          },
        });
        if (
          existingUser &&
          !existingUser.isDeleted &&
          existingUser.memberships.some(
            (membership) => membership.businessId !== businessId,
          )
        ) {
          throw new ApiError(
            TEAM_ERRORS.INVITATION_EMAIL_IN_USE,
            STATUS_CODE.CONFLICT,
          );
        }
        /* A soft-deleted account keeps its email; a token would be unusable. */
        if (existingUser?.isDeleted)
          throw new ApiError(
            TEAM_ERRORS.INVITATION_EMAIL_DELETED,
            STATUS_CODE.CONFLICT,
          );

        await tx.invitation.updateMany({
          where: {
            businessId,
            email,
            status: INVITATION_STATUS.PENDING,
          },
          data: { status: INVITATION_STATUS.REVOKED },
        });

        const created = await tx.invitation.create({
          data: {
            businessId,
            email,
            role: input.role as UserRole,
            tokenHash: token.hash,
            status: INVITATION_STATUS.PENDING,
            invitedByUserId: actorUserId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          },
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId,
            actorType: "USER",
            actorId: actorUserId,
            action: AUDIT_ACTION.TEAM_INVITATION_CREATED,
            resourceType: "Invitation",
            resourceId: created.id,
            metadata: { invitationId: created.id },
          }),
        });

        return created;
      });

      return {
        invitation: this.invitationView(invitation),
        token: token.raw,
        link: invitationLink(token.raw),
        emailSent: false,
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ApiError(
          "A newer invitation already exists for this email",
          STATUS_CODE.CONFLICT,
        );
      throw error;
    }
  }

  /** Rotate the token and extend the expiry for a pending or expired invite. */
  async resend(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    invitationId: string,
  ) {
    assertOperator(role);
    const token = newToken();

    const invitation = await this.db.$transaction(async (tx) => {
      const existing = await tx.invitation.findFirst({
        where: { id: invitationId, businessId },
      });
      if (!existing) throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
      await this.business(tx, businessId);
      if (
        existing.status === INVITATION_STATUS.ACCEPTED ||
        existing.status === INVITATION_STATUS.REVOKED
      ) {
        throw new ApiError(
          TEAM_ERRORS.INVITATION_NOT_PENDING,
          STATUS_CODE.CONFLICT,
        );
      }

      await tx.invitation.updateMany({
        where: {
          businessId,
          email: existing.email,
          status: INVITATION_STATUS.PENDING,
          id: { not: existing.id },
        },
        data: { status: INVITATION_STATUS.REVOKED },
      });

      const updated = await tx.invitation.update({
        where: { id: existing.id },
        data: {
          tokenHash: token.hash,
          status: INVITATION_STATUS.PENDING,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          acceptedAt: null,
          acceptedByUserId: null,
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.TEAM_INVITATION_RESENT,
          resourceType: "Invitation",
          resourceId: updated.id,
          metadata: { invitationId: updated.id },
        }),
      });

      return updated;
    });

    return {
      invitation: this.invitationView(invitation),
      token: token.raw,
      link: invitationLink(token.raw),
      emailSent: false,
    };
  }

  async revoke(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    invitationId: string,
  ) {
    assertOperator(role);

    return this.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id: invitationId, businessId },
      });
      if (!invitation) throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
      if (invitation.status !== INVITATION_STATUS.PENDING)
        throw new ApiError(
          TEAM_ERRORS.INVITATION_NOT_PENDING,
          STATUS_CODE.CONFLICT,
        );

      const updated = await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: INVITATION_STATUS.REVOKED },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.TEAM_INVITATION_REVOKED,
          resourceType: "Invitation",
          resourceId: updated.id,
          metadata: { invitationId: updated.id },
        }),
      });

      return { invitation: this.invitationView(updated) };
    });
  }

  /**
   * Public read used by the invitation page before the visitor signs in.
   * Unknown, revoked, expired and accepted tokens all return the same 404.
   */
  async resolve(token: string) {
    if (!token || token.length > 200)
      throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);

    const invitation = await this.db.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        business: { select: { id: true, legalName: true, status: true } },
      },
    });

    if (
      !invitation ||
      invitation.status !== INVITATION_STATUS.PENDING ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      if (
        invitation &&
        invitation.status === INVITATION_STATUS.PENDING &&
        invitation.expiresAt.getTime() <= Date.now()
      ) {
        await this.db.invitation.update({
          where: { id: invitation.id },
          data: { status: INVITATION_STATUS.EXPIRED },
        });
      }
      throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
    }

    if (
      invitation.business.status === BUSINESS_STATUS.SUSPENDED ||
      invitation.business.status === BUSINESS_STATUS.CLOSED
    ) {
      throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
    }

    return {
      invitation: {
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        business: {
          id: invitation.business.id,
          legalName: invitation.business.legalName,
        },
      },
    };
  }

  /**
   * Join an existing account to the invited business.
   *
   * The signed-in email must match the invitation. A user whose only active
   * membership is in another business is refused: a single JWT is scoped to
   * one tenant, so silently switching would be ambiguous.
   */
  async accept(userId: string, token: string) {
    const raw = await this.db.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !raw ||
      raw.status !== INVITATION_STATUS.PENDING ||
      raw.expiresAt.getTime() <= Date.now()
    ) {
      throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
    }

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, tokenVersion: true },
    });
    if (!user) throw new ApiError(USER_ERRORS.NOT_FOUND, 404);

    if (normalizeEmail(user.email) !== normalizeEmail(raw.email))
      throw new ApiError(
        TEAM_ERRORS.INVITATION_EMAIL_MISMATCH,
        STATUS_CODE.FORBIDDEN,
      );

    const result = await this.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { id: raw.id },
      });
      if (
        !invitation ||
        invitation.status !== INVITATION_STATUS.PENDING ||
        invitation.expiresAt.getTime() <= Date.now()
      ) {
        throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
      }

      const business = await this.business(tx, invitation.businessId);

      const otherBusiness = await tx.businessMember.findFirst({
        where: {
          userId,
          status: MEMBERSHIP_STATUS.ACTIVE,
          businessId: { not: invitation.businessId },
        },
        select: { id: true },
      });
      if (otherBusiness)
        throw new ApiError(
          TEAM_ERRORS.INVITATION_OTHER_BUSINESS,
          STATUS_CODE.CONFLICT,
        );

      const existing = await tx.businessMember.findUnique({
        where: {
          businessId_userId: {
            businessId: invitation.businessId,
            userId,
          },
        },
      });

      /*
       * Disabled is terminal. A stale invitation token must not restore access
       * that an owner deliberately removed.
       */
      if (existing?.status === MEMBERSHIP_STATUS.DISABLED)
        throw new ApiError(TEAM_ERRORS.MEMBER_DISABLED, STATUS_CODE.CONFLICT);

      const membership = existing
        ? await tx.businessMember.update({
            where: { id: existing.id },
            data: {
              role: invitation.role,
              status: MEMBERSHIP_STATUS.ACTIVE,
              joinedAt: existing.joinedAt ?? new Date(),
            },
            select: MEMBER_SELECT,
          })
        : await tx.businessMember.create({
            data: {
              businessId: invitation.businessId,
              userId,
              role: invitation.role,
              status: MEMBERSHIP_STATUS.ACTIVE,
              joinedAt: new Date(),
            },
            select: MEMBER_SELECT,
          });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: INVITATION_STATUS.ACCEPTED,
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId: invitation.businessId,
          actorType: "USER",
          actorId: userId,
          action: AUDIT_ACTION.TEAM_INVITATION_ACCEPTED,
          resourceType: "Invitation",
          resourceId: invitation.id,
          metadata: {
            invitationId: invitation.id,
            membershipId: membership.id,
          },
        }),
      });

      return { business, membership, invitation };
    });

    /*
     * The accept request is authenticated against whatever business the JWT
     * carried. Re-issue it for the invited tenant so the browser lands on the
     * right workspace even after a role change.
     */
    const tokenForSession = generateToken({
      userId: user.id,
      businessId: result.business.id,
      userRole: result.membership.role,
      tokenVersion: user.tokenVersion,
    });

    return {
      token: tokenForSession,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: result.membership.role,
      },
      business: {
        id: result.business.id,
        legalName: result.business.legalName,
        currency: result.business.currency,
        status: result.business.status,
      },
      membership: this.memberView(result.membership, userId),
    };
  }

  /**
   * Token-gated registration: the one safe exception to "public registration
   * creates an OWNER". The email is taken from the invitation, the role is
   * fixed to EMPLOYEE/ADMIN, and no business is created.
   */
  async registerFromInvitation(
    token: string,
    input: { username: string; password: string },
  ) {
    const hashedPassword = await bcrypt.hash(input.password, 10);
    const raw = await this.db.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !raw ||
      raw.status !== INVITATION_STATUS.PENDING ||
      raw.expiresAt.getTime() <= Date.now()
    ) {
      throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
    }

    try {
      const result = await this.db.$transaction(async (tx) => {
        const invitation = await tx.invitation.findUnique({
          where: { id: raw.id },
        });
        if (
          !invitation ||
          invitation.status !== INVITATION_STATUS.PENDING ||
          invitation.expiresAt.getTime() <= Date.now()
        ) {
          throw new ApiError(TEAM_ERRORS.INVITATION_INVALID, 404);
        }

        const business = await this.business(tx, invitation.businessId);

        const existingEmail = await tx.user.findUnique({
          where: { email: invitation.email },
          select: { id: true },
        });
        if (existingEmail)
          throw new ApiError(
            TEAM_ERRORS.INVITATION_EMAIL_REGISTERED,
            STATUS_CODE.CONFLICT,
          );

        const existingUsername = await tx.user.findFirst({
          where: { username: input.username },
          select: { id: true },
        });
        if (existingUsername)
          throw new ApiError(
            USER_ERRORS.USERNAME_ALREADY_EXISTS,
            STATUS_CODE.CONFLICT,
          );

        const user = await tx.user.create({
          data: {
            username: input.username,
            email: invitation.email,
            password: hashedPassword,
          },
          select: {
            id: true,
            username: true,
            email: true,
            tokenVersion: true,
          },
        });

        const membership = await tx.businessMember.create({
          data: {
            businessId: invitation.businessId,
            userId: user.id,
            role: invitation.role,
            status: MEMBERSHIP_STATUS.ACTIVE,
            joinedAt: new Date(),
          },
          select: MEMBER_SELECT,
        });

        await tx.invitation.update({
          where: { id: invitation.id },
          data: {
            status: INVITATION_STATUS.ACCEPTED,
            acceptedAt: new Date(),
            acceptedByUserId: user.id,
          },
        });

        await tx.auditLog.create({
          data: auditEntry({
            businessId: invitation.businessId,
            actorType: "USER",
            actorId: user.id,
            action: AUDIT_ACTION.TEAM_INVITATION_ACCEPTED,
            resourceType: "Invitation",
            resourceId: invitation.id,
            metadata: {
              invitationId: invitation.id,
              membershipId: membership.id,
            },
          }),
        });

        return { user, business, membership, invitation };
      });

      const sessionToken = generateToken({
        userId: result.user.id,
        businessId: result.business.id,
        userRole: result.membership.role,
        tokenVersion: result.user.tokenVersion,
      });

      return {
        token: sessionToken,
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          role: result.membership.role,
        },
        business: {
          id: result.business.id,
          legalName: result.business.legalName,
          currency: result.business.currency,
          status: result.business.status,
        },
        membership: this.memberView(result.membership, result.user.id),
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error))
        throw new ApiError(
          TEAM_ERRORS.INVITATION_EMAIL_REGISTERED,
          STATUS_CODE.CONFLICT,
        );
      throw error;
    }
  }

  async changeRole(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    memberId: string,
    nextRole: string,
  ) {
    assertOwner(role);
    assertInvitable(nextRole);

    const result = await this.db.$transaction(async (tx) => {
      const member = await tx.businessMember.findFirst({
        where: { id: memberId, businessId },
        select: MEMBER_SELECT,
      });
      if (!member) throw new ApiError(TEAM_ERRORS.MEMBER_NOT_FOUND, 404);
      if (member.userId === actorUserId)
        throw new ApiError(TEAM_ERRORS.SELF_ROLE_CHANGE, STATUS_CODE.FORBIDDEN);
      if (member.role === USER_ROLE.OWNER)
        throw new ApiError(
          TEAM_ERRORS.OWNER_ROLE_LOCKED,
          STATUS_CODE.FORBIDDEN,
        );
      if (member.status !== MEMBERSHIP_STATUS.ACTIVE)
        throw new ApiError(TEAM_ERRORS.MEMBER_NOT_ACTIVE, STATUS_CODE.CONFLICT);

      if (member.role === nextRole) return member;

      const updated = await tx.businessMember.update({
        where: { id: member.id },
        data: { role: nextRole as UserRole },
        select: MEMBER_SELECT,
      });

      /* The old JWT carries the old role; invalidate it immediately. */
      await tx.user.update({
        where: { id: member.userId },
        data: { tokenVersion: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.TEAM_ROLE_CHANGED,
          resourceType: "BusinessMember",
          resourceId: updated.id,
          metadata: { memberId: updated.id, fields: ["role"] },
        }),
      });

      return updated;
    });

    return { member: this.memberView(result, actorUserId) };
  }

  async disableMember(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    memberId: string,
  ) {
    assertOwner(role);

    const result = await this.db.$transaction(async (tx) => {
      const member = await tx.businessMember.findFirst({
        where: { id: memberId, businessId },
        select: MEMBER_SELECT,
      });
      if (!member) throw new ApiError(TEAM_ERRORS.MEMBER_NOT_FOUND, 404);
      if (member.userId === actorUserId)
        throw new ApiError(TEAM_ERRORS.SELF_DISABLE, STATUS_CODE.FORBIDDEN);
      if (member.role === USER_ROLE.OWNER)
        throw new ApiError(
          TEAM_ERRORS.OWNER_ROLE_LOCKED,
          STATUS_CODE.FORBIDDEN,
        );
      if (member.status === MEMBERSHIP_STATUS.DISABLED) return member;

      const updated = await tx.businessMember.update({
        where: { id: member.id },
        data: { status: MEMBERSHIP_STATUS.DISABLED },
        select: MEMBER_SELECT,
      });

      /* Existing JWTs stop working on their very next request. */
      await tx.user.update({
        where: { id: member.userId },
        data: { tokenVersion: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.TEAM_MEMBER_DISABLED,
          resourceType: "BusinessMember",
          resourceId: updated.id,
          metadata: { memberId: updated.id },
        }),
      });

      return updated;
    });

    return { member: this.memberView(result, actorUserId) };
  }

  async getApprovalPolicy(businessId: string, role: UserRole) {
    assertOperator(role);
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: {
        currency: true,
        approvalThresholdMinor: true,
        requireSeparateApprover: true,
      },
    });
    if (!business) throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, 404);
    return { policy: this.policyView(business) };
  }

  async updateApprovalPolicy(
    actorUserId: string,
    businessId: string,
    role: UserRole,
    input: ApprovalPolicyInput,
  ) {
    assertOwner(role);

    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: {
        currency: true,
        approvalThresholdMinor: true,
        requireSeparateApprover: true,
      },
    });
    if (!business) throw new ApiError(BUSINESS_ERRORS.NOT_FOUND, 404);

    let threshold = business.approvalThresholdMinor;
    if (input.approvalThresholdMinor !== undefined) {
      if (!/^\d{1,18}$/.test(input.approvalThresholdMinor))
        throw new ApiError(TEAM_ERRORS.THRESHOLD_INVALID, 400);
      threshold = BigInt(input.approvalThresholdMinor);
      if (threshold > MAX_APPROVAL_THRESHOLD_MINOR)
        throw new ApiError(TEAM_ERRORS.THRESHOLD_TOO_LARGE, 422);
    }

    const fields: string[] = [];
    if (input.approvalThresholdMinor !== undefined)
      fields.push("approvalThresholdMinor");

    const updated = await this.db.$transaction(async (tx) => {
      const next = await tx.business.update({
        where: { id: businessId },
        data: {
          ...(input.approvalThresholdMinor !== undefined
            ? { approvalThresholdMinor: threshold }
            : {}),
        },
        select: {
          currency: true,
          approvalThresholdMinor: true,
          requireSeparateApprover: true,
        },
      });

      await tx.auditLog.create({
        data: auditEntry({
          businessId,
          actorType: "USER",
          actorId: actorUserId,
          action: AUDIT_ACTION.APPROVAL_POLICY_UPDATED,
          resourceType: "Business",
          resourceId: businessId,
          metadata: {
            fields,
            /* Amount classes, not the raw threshold. */
            thresholdFrom: thresholdClass(business.approvalThresholdMinor),
            thresholdTo: thresholdClass(next.approvalThresholdMinor),
          },
        }),
      });

      return next;
    });

    return { policy: this.policyView(updated) };
  }
}
