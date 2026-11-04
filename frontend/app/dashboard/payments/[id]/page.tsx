"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { Alert, StatusPill } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextareaField } from "@/components/ui/field";
import { ApiClientError } from "@/lib/api";
import { formatDate, roleLabel } from "@/lib/dashboard";
import type { UserRole } from "@/lib/auth";
import { formatMinor } from "@/lib/money";
import {
  paymentStatus,
  paymentsApi,
  type PaymentRequestView,
} from "@/lib/payments";
import type { CurrentBusiness } from "@/lib/business";

export default function PaymentDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted">
            Opening payment…
          </p>
        </div>
      }
    >
      <PaymentDetailRoute />
    </Suspense>
  );
}

function PaymentDetailRoute() {
  const params = useParams<{ id: string }>();
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OPERATIONS" ? (
          <Refusal role={current.role} />
        ) : (
          <DashboardShell current={current}>
            <PaymentDetail id={params.id} current={current} />
          </DashboardShell>
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

function PaymentDetail({
  id,
  current,
}: {
  id: string;
  current: CurrentBusiness;
}) {
  const [request, setRequest] = useState<PaymentRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | "cancel" | null>(
    null,
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setRequest(await paymentsApi.detail(id));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, [id]);

  useEffect(() => {
    let active = true;

    void paymentsApi
      .detail(id)
      .then((next) => {
        if (active) setRequest(next);
      })
      .catch((caught) => {
        if (active) setError(messageOf(caught));
      });

    return () => {
      active = false;
    };
  }, [id]);

  function apply(next: PaymentRequestView, message: string) {
    setRequest(next);
    setNotice(message);
    setStale(false);
    setRejecting(false);
    setReason("");
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    setStale(false);
    try {
      apply(await paymentsApi.approve(id), "Payment approved and posted.");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) {
        setStale(true);
        await load();
      }
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  async function reject(event: React.FormEvent) {
    event.preventDefault();
    setBusy("reject");
    setError(null);
    setStale(false);
    try {
      apply(
        await paymentsApi.reject(id, reason.trim()),
        "Payment rejected. Nothing was posted.",
      );
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) {
        setStale(true);
        await load();
      }
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this payment request? Nothing will be posted.")) {
      return;
    }
    setBusy("cancel");
    setError(null);
    setStale(false);
    try {
      apply(await paymentsApi.cancel(id), "Payment request canceled.");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) {
        setStale(true);
        await load();
      }
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  if (!request && !error) {
    return <div className="h-64 animate-pulse border border-rule bg-paper-raised" />;
  }

  if (!request) {
    return (
      <div>
        <p className="eyebrow">Payments / detail</p>
        <Alert tone="error" label="Payment" className="mt-6">
          {error}
        </Alert>
        <Link
          href="/dashboard/payments"
          className="mt-5 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-teal underline decoration-teal/30 underline-offset-4"
        >
          Back to payments
        </Link>
      </div>
    );
  }

  const status = paymentStatus(request.status);
  const pending = request.status === "PENDING_APPROVAL";
  const creator = request.createdBy?.email ?? "the creator";

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Payments / detail</p>
        <Link
          href="/dashboard/payments"
          className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted transition-colors hover:text-teal"
        >
          ← All payments
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-5 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="max-w-2xl break-words font-heading text-[clamp(2rem,5vw,3.4rem)] font-light leading-[1.03] tracking-[-0.035em] text-ink">
            {formatMinor(request.amountMinor, request.currency)}
          </h1>
          <p className="mt-2 text-[14px] text-ink">
            to {request.beneficiaryName}
            {request.beneficiaryReference ? (
              <span className="text-ink-muted">
                {" "}
                · {request.beneficiaryReference}
              </span>
            ) : null}
          </p>
        </div>
        <StatusPill label={status.label} tone={status.tone} />
      </div>

      {error ? (
        <Alert tone="error" label="Payment" className="mt-6">
          {error}
        </Alert>
      ) : null}
      {stale ? (
        <Alert tone="warn" label="Already decided" className="mt-6">
          Another person decided this request while this page was open. The
          latest state is shown below; nothing was posted twice.
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" label="Payment" className="mt-6">
          {notice}
        </Alert>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <section className="min-w-0">
          <dl className="grid gap-5 border-y border-rule py-5 sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                Created by
              </dt>
              <dd className="mt-1 text-[13px] text-ink">
                {request.createdBy?.username ?? creator}
                <span className="block font-mono text-[10px] text-ink-muted">
                  {request.createdBy?.email}
                </span>
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                Created
              </dt>
              <dd className="mt-1 text-[13px] text-ink">
                {formatDate(request.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                Threshold at creation
              </dt>
              <dd className="mt-1 text-[13px] text-ink">
                {request.approvalThresholdMinor === "0"
                  ? "Every payment needed approval"
                  : formatMinor(
                      request.approvalThresholdMinor,
                      request.currency,
                    )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                Memo
              </dt>
              <dd className="mt-1 break-words text-[13px] text-ink">
                {request.memo ?? "—"}
              </dd>
            </div>
          </dl>

          <h2 className="mt-8 font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            History
          </h2>
          <ol className="mt-3 border-l border-rule pl-5">
            <li className="relative pb-5">
              <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full border border-teal bg-paper" />
              <p className="text-[13px] text-ink">Request created</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                {request.createdBy?.email}
                <span className="px-1.5 text-teal">·</span>
                {formatDate(request.createdAt)}
              </p>
            </li>
            {request.approvals.map((approval) => (
              <li key={approval.id} className="relative pb-5">
                <span
                  className={
                    approval.decision === "APPROVED"
                      ? "absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-teal"
                      : "absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-vermilion"
                  }
                />
                <p className="text-[13px] text-ink">
                  {approval.decision === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                  {approval.actor.username}
                  <span className="text-ink-muted">
                    {" "}
                    · {roleLabel(approval.actorRole as UserRole)}
                  </span>
                </p>
                {approval.reason ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                    “{approval.reason}”
                  </p>
                ) : null}
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                  {approval.actor.email}
                  <span className="px-1.5 text-teal">·</span>
                  {formatDate(approval.createdAt)}
                </p>
              </li>
            ))}
            {request.status === "COMPLETED" ? (
              <li className="relative pb-5">
                <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-teal" />
                <p className="text-[13px] text-ink">Posted to the ledger</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                  {request.ledgerTransactionId ?? "ledger transaction"}
                </p>
              </li>
            ) : null}
            {request.status === "CANCELED" ? (
              <li className="relative pb-5">
                <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-ink/35" />
                <p className="text-[13px] text-ink">Canceled by the creator</p>
              </li>
            ) : null}
          </ol>

          {request.ledgerTransaction ? (
            <div className="mt-4 border border-rule bg-paper-raised p-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                Ledger transaction
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink">
                {request.ledgerTransaction.id}
              </p>
              <ul className="mt-3 divide-y divide-rule border-t border-rule">
                {request.ledgerTransaction.lines.map((line, index) => (
                  <li
                    key={`${line.accountCode}-${index}`}
                    className="flex items-center justify-between gap-3 py-2 font-mono text-[11px]"
                  >
                    <span className="text-ink-muted">
                      {line.accountCode} {line.accountName}
                    </span>
                    <span className="text-ink">
                      {line.direction} {line.amountMinor}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside>
          <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            Decision
          </h2>

          {!pending ? (
            <p className="mt-3 border border-rule bg-paper-raised p-4 text-[12px] leading-relaxed text-ink-muted">
              This request is {status.label.toLowerCase()} and cannot be decided
              again. Rejected and canceled requests are terminal.
            </p>
          ) : request.canApprove ? (
            <div className="mt-3 border border-rule bg-paper-raised p-4">
              <p className="text-[12px] leading-relaxed text-ink-muted">
                You are not the creator. Approving posts one balanced ledger
                transaction; rejecting posts nothing.
              </p>
              {!rejecting ? (
                <div className="mt-4 grid gap-3">
                  <SubmitButton
                    type="button"
                    loading={busy === "approve"}
                    onClick={() => void approve()}
                  >
                    Approve and post
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    className="h-12 border border-vermilion/35 px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion transition-colors hover:bg-vermilion/[0.06]"
                  >
                    Reject with a reason
                  </button>
                </div>
              ) : (
                <form onSubmit={reject} className="mt-4">
                  <TextareaField
                    label="Rejection reason"
                    name="rejection-reason"
                    required
                    minLength={3}
                    maxLength={280}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    hint="Required. This is recorded against your name."
                  />
                  <div className="mt-4 grid gap-3">
                    <SubmitButton
                      type="submit"
                      loading={busy === "reject"}
                      variant="outline"
                    >
                      Confirm rejection
                    </SubmitButton>
                    <button
                      type="button"
                      onClick={() => {
                        setRejecting(false);
                        setReason("");
                      }}
                      className="h-10 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted hover:text-ink"
                    >
                      Back
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : request.isCreator ? (
            <div className="mt-3 border border-rule bg-paper-raised p-4">
              <p className="text-[12px] leading-relaxed text-ink-muted">
                You created this request, so you cannot approve or reject it. A
                different owner or admin must decide.
              </p>
              <div className="mt-4">
                <SubmitButton
                  type="button"
                  loading={busy === "cancel"}
                  variant="outline"
                  onClick={() => void cancel()}
                >
                  Cancel request
                </SubmitButton>
              </div>
            </div>
          ) : (
            <p className="mt-3 border border-rule bg-paper-raised p-4 text-[12px] leading-relaxed text-ink-muted">
              Only an owner or admin can decide this request.
            </p>
          )}

          {request.paymentRail.simulated ? (
            <p className="mt-4 border-t border-rule pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
              Simulator · no real bank transfer
            </p>
          ) : null}
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted/70">
            Workspace {current.business.currency}
          </p>
        </aside>
      </div>
    </div>
  );
}
