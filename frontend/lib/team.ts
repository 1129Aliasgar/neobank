/**
 * Team, invitation and approval-policy calls.
 *
 * Types mirror `TeamService` responses. The raw invitation token and link are
 * present only on create/resend; every later read returns the hashed record.
 */

import { api, type ApiSuccess } from "./api";
import type { UserRole } from "./auth";

export type MembershipStatus = "INVITED" | "ACTIVE" | "DISABLED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type InvitableRole = "EMPLOYEE" | "ADMIN";

export interface TeamMember {
  id: string;
  businessId: string;
  userId: string;
  role: UserRole;
  status: MembershipStatus;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isYou: boolean;
  user: {
    id: string;
    username: string;
    email: string;
    isDeleted: boolean;
  };
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedByUserId: string;
  acceptedAt: string | null;
}

export interface ApprovalPolicy {
  approvalThresholdMinor: string;
  requireSeparateApprover: boolean;
  maxApprovalThresholdMinor: string;
  currency: string;
  paymentRail: { driver: string; simulated: boolean };
}

export interface TeamView {
  business: {
    id: string;
    legalName: string;
    currency: string;
    status: string;
  };
  members: TeamMember[];
  invitations: TeamInvitation[];
  policy: ApprovalPolicy;
  canManageMembers: boolean;
  canInvite: boolean;
}

export interface InvitationLinkResult {
  invitation: TeamInvitation;
  /** Present exactly once, on create or resend. */
  token: string;
  link: string;
  emailSent: boolean;
}

export interface InvitationPreview {
  invitation: {
    email: string;
    role: UserRole;
    expiresAt: string;
    business: { id: string; legalName: string };
  };
}

export interface InvitationSession {
  token: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: UserRole;
  };
  business: {
    id: string;
    legalName: string;
    currency: string;
    status: string;
  };
  membership: TeamMember;
}

export const teamApi = {
  async current(): Promise<TeamView> {
    const { data } = await api.get<ApiSuccess<TeamView>>("/team");
    return data.data;
  },

  async invite(input: {
    email: string;
    role: InvitableRole;
  }): Promise<InvitationLinkResult> {
    const { data } = await api.post<ApiSuccess<InvitationLinkResult>>(
      "/team/invitations",
      input,
    );
    return data.data;
  },

  async resend(id: string): Promise<InvitationLinkResult> {
    const { data } = await api.post<ApiSuccess<InvitationLinkResult>>(
      `/team/invitations/${id}/resend`,
    );
    return data.data;
  },

  async revoke(id: string): Promise<TeamInvitation> {
    const { data } = await api.delete<
      ApiSuccess<{ invitation: TeamInvitation }>
    >(`/team/invitations/${id}`);
    return data.data.invitation;
  },

  async changeRole(id: string, role: InvitableRole): Promise<TeamMember> {
    const { data } = await api.patch<ApiSuccess<{ member: TeamMember }>>(
      `/team/members/${id}`,
      { role },
    );
    return data.data.member;
  },

  async disable(id: string): Promise<TeamMember> {
    const { data } = await api.delete<ApiSuccess<{ member: TeamMember }>>(
      `/team/members/${id}`,
    );
    return data.data.member;
  },

  /** Public: resolve the invitation page's token before anyone signs in. */
  async resolve(token: string): Promise<InvitationPreview> {
    const { data } = await api.get<ApiSuccess<InvitationPreview>>(
      `/team/invitations/${encodeURIComponent(token)}`,
    );
    return data.data;
  },

  async accept(token: string): Promise<InvitationSession> {
    const { data } = await api.post<ApiSuccess<InvitationSession>>(
      `/team/invitations/${encodeURIComponent(token)}/accept`,
    );
    return data.data;
  },

  async register(
    token: string,
    input: { username: string; password: string },
  ): Promise<InvitationSession> {
    const { data } = await api.post<ApiSuccess<InvitationSession>>(
      `/team/invitations/${encodeURIComponent(token)}/register`,
      input,
    );
    return data.data;
  },

  async policy(): Promise<ApprovalPolicy> {
    const { data } = await api.get<ApiSuccess<{ policy: ApprovalPolicy }>>(
      "/businesses/current/approval-policy",
    );
    return data.data.policy;
  },

  async updatePolicy(input: {
    approvalThresholdMinor?: string;
    requireSeparateApprover?: boolean;
  }): Promise<ApprovalPolicy> {
    const { data } = await api.patch<ApiSuccess<{ policy: ApprovalPolicy }>>(
      "/businesses/current/approval-policy",
      input,
    );
    return data.data.policy;
  },
};
