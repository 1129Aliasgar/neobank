"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { Alert } from "@/components/ui/alert";
import { ApiClientError } from "@/lib/api";
import { formatDate } from "@/lib/dashboard";
import { useDashboardSession } from "@/lib/dashboard-session";
import { formatMinor } from "@/lib/money";
import { paymentsApi, type PaymentSummary } from "@/lib/payments";
import type { CurrentBusiness } from "@/lib/business";

export default function ApprovalsPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OWNER" || current.role === "ADMIN" ? (
          <DashboardShell current={current}>
            <ApprovalsContent current={current} />
          </DashboardShell>
        ) : (
          <Refusal role={current.role} />
        )
      }
    </OnboardingGate>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiClientError || error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

function ApprovalsContent({ current }: { current: CurrentBusiness }) {
  const { user } = useDashboardSession();
  const [requests, setRequests] = useState<PaymentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void paymentsApi
      .queue()
      .then((queue) => {
        if (active) setRequests(queue.requests);
      })
      .catch((caught) => {
        if (active) {
          setError(messageOf(caught));
          setRequests([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="animate-rise">
      <p className="eyebrow">Business account / approvals</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
            Approvals
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            Requests waiting for a decision, oldest first. The creator can never
            decide their own request, and no agent or system principal can
            approve.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          {requests === null ? "—" : requests.length} pending
        </p>
      </div>

      {error ? (
        <Alert tone="error" label="Approvals" className="mt-6">
          {error}
        </Alert>
      ) : null}

      {requests === null ? (
        <div className="mt-8 space-y-px border border-rule bg-rule">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-24 animate-pulse bg-paper-raised" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <section className="mt-8 border border-rule bg-paper-raised p-6">
          <p className="font-heading text-[1.3rem] font-light text-ink">
            The queue is clear.
          </p>
          <p className="mt-2 max-w-md text-[12px] leading-relaxed text-ink-muted">
            New requests appear here as soon as another person creates one. You
            can review the full history in{" "}
            <Link
              href="/dashboard/payments"
              className="text-ink underline decoration-teal/40 underline-offset-4 hover:text-teal"
            >
              Payments
            </Link>
            .
          </p>
        </section>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/dashboard/payments/${request.id}`}
                className="flex flex-wrap items-start justify-between gap-4 py-5 transition-colors hover:bg-ink/[0.02]"
              >
                <div className="min-w-0">
                  <p className="font-heading text-[1.4rem] font-light tracking-[-0.02em] text-ink">
                    {formatMinor(request.amountMinor, request.currency)}
                  </p>
                  <p className="mt-1 truncate text-[13px] text-ink">
                    to {request.beneficiaryName}
                    {request.beneficiaryReference ? (
                      <span className="text-ink-muted">
                        {" "}
                        · {request.beneficiaryReference}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                    Created by{" "}
                    {request.createdBy?.username ??
                      request.createdBy?.email ??
                      "a teammate"}
                    <span className="px-1.5 text-teal">·</span>
                    {formatDate(request.createdAt)}
                  </p>
                </div>
                <span
                  className={
                    user?.id === request.createdByUserId
                      ? "shrink-0 border border-rule bg-ink/[0.03] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted"
                      : "shrink-0 border border-gold/45 bg-gold/[0.08] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7a5a17]"
                  }
                >
                  {user?.id === request.createdByUserId
                    ? "Your request"
                    : "Needs review"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted/70">
        Workspace {current.business.currency}
        <span className="px-1.5 text-teal">·</span>
        approval is a human action
      </p>
    </div>
  );
}
