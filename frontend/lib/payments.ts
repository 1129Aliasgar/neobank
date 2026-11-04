/**
 * Payment-request and approval calls.
 *
 * The rail is a simulator. Nothing here moves real money, and the API says so
 * in every response (`paymentRail.simulated`).
 */

import { api, type ApiSuccess } from "./api";

export type PaymentRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELED"
  | "FAILED";

export type ApprovalDecision = "APPROVED" | "REJECTED";

export interface PaymentActor {
  id: string;
  username: string;
  email: string;
}

export interface PaymentApproval {
  id: string;
  actorUserId: string;
  actorRole: string;
  decision: ApprovalDecision;
  reason: string | null;
  createdAt: string;
  actor: PaymentActor;
}

export interface PaymentLedgerLine {
  accountCode: string;
  accountName: string;
  direction: string;
  amountMinor: string;
}

export interface PaymentLedger {
  id: string;
  kind: string;
  status: string;
  amountMinor: string;
  currency: string;
  description: string;
  occurredAt: string;
  postedAt: string;
  source: { type: string; id: string | null };
  lines: PaymentLedgerLine[];
}

export interface PaymentRequestView {
  id: string;
  businessId: string;
  status: PaymentRequestStatus;
  amountMinor: string;
  currency: string;
  beneficiaryName: string;
  beneficiaryReference: string | null;
  memo: string | null;
  createdByUserId: string;
  createdBy: PaymentActor;
  isCreator: boolean;
  decisionByUserId: string | null;
  decisionBy: PaymentActor | null;
  decidedAt: string | null;
  approvalThresholdMinor: string;
  requiredApprovals: number;
  approvalsCount: number;
  ledgerTransactionId: string | null;
  ledgerTransaction: PaymentLedger | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvals: PaymentApproval[];
  canApprove: boolean;
  canCancel: boolean;
  paymentRail: { driver: string; simulated: boolean };
}

export interface PaymentSummary {
  id: string;
  status: PaymentRequestStatus;
  amountMinor: string;
  currency: string;
  beneficiaryName: string;
  beneficiaryReference: string | null;
  createdByUserId: string;
  createdBy?: PaymentActor;
  decisionByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface PaymentList {
  requests: PaymentSummary[];
  nextCursor: string | null;
}

export interface PaymentCreateResult {
  request: PaymentRequestView;
  replayed: boolean;
}

export type PaymentStatusTone =
  "neutral" | "progress" | "positive" | "negative" | "attention";

const PAYMENT_STATUS: Record<
  PaymentRequestStatus,
  { label: string; tone: PaymentStatusTone }
> = {
  PENDING_APPROVAL: { label: "Pending approval", tone: "progress" },
  APPROVED: { label: "Approved", tone: "progress" },
  PROCESSING: { label: "Processing", tone: "progress" },
  COMPLETED: { label: "Completed", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  FAILED: { label: "Failed", tone: "negative" },
};

export function paymentStatus(status: PaymentRequestStatus): {
  label: string;
  tone: PaymentStatusTone;
} {
  return PAYMENT_STATUS[status];
}

/** Human copy for a status, used where a pill is too heavy. */
export function paymentStatusLabel(status: PaymentRequestStatus): string {
  return PAYMENT_STATUS[status].label;
}

export const paymentsApi = {
  async list(
    query: {
      status?: PaymentRequestStatus;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<PaymentList> {
    const { data } = await api.get<ApiSuccess<PaymentList>>("/payments", {
      params: query,
    });
    return data.data;
  },

  async create(
    input: {
      beneficiaryName: string;
      beneficiaryReference?: string;
      amountMinor: string;
      memo?: string;
    },
    idempotencyKey: string,
  ): Promise<PaymentCreateResult> {
    const { data } = await api.post<ApiSuccess<PaymentCreateResult>>(
      "/payments",
      input,
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
    return data.data;
  },

  async detail(id: string): Promise<PaymentRequestView> {
    const { data } = await api.get<ApiSuccess<{ request: PaymentRequestView }>>(
      `/payments/${id}`,
    );
    return data.data.request;
  },

  async approve(id: string, reason?: string): Promise<PaymentRequestView> {
    const { data } = await api.post<
      ApiSuccess<{ request: PaymentRequestView }>
    >(`/payments/${id}/approve`, reason ? { reason } : {});
    return data.data.request;
  },

  async reject(id: string, reason: string): Promise<PaymentRequestView> {
    const { data } = await api.post<
      ApiSuccess<{ request: PaymentRequestView }>
    >(`/payments/${id}/reject`, { reason });
    return data.data.request;
  },

  async cancel(id: string): Promise<PaymentRequestView> {
    const { data } = await api.post<
      ApiSuccess<{ request: PaymentRequestView }>
    >(`/payments/${id}/cancel`);
    return data.data.request;
  },

  async queue(): Promise<{ requests: PaymentSummary[]; count: number }> {
    const { data } =
      await api.get<ApiSuccess<{ requests: PaymentSummary[]; count: number }>>(
        "/approvals",
      );
    return data.data;
  },
};
