"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { Alert, StatusPill } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ApiClientError } from "@/lib/api";
import { formatDate } from "@/lib/dashboard";
import { formatMinor, parseDollarsToMinor } from "@/lib/money";
import {
  paymentStatus,
  paymentsApi,
  type PaymentSummary,
} from "@/lib/payments";
import type { CurrentBusiness } from "@/lib/business";

export default function PaymentsPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OPERATIONS" ? (
          <Refusal role={current.role} />
        ) : (
          <DashboardShell current={current}>
            <PaymentsContent current={current} />
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

function PaymentsContent({ current }: { current: CurrentBusiness }) {
  const [requests, setRequests] = useState<PaymentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryReference, setBeneficiaryReference] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await paymentsApi.list({ limit: 50 });
      setRequests(page.requests);
    } catch (caught) {
      setError(messageOf(caught));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void paymentsApi
      .list({ limit: 50 })
      .then((page) => {
        if (active) setRequests(page.requests);
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

  let previewMinor: string | null = null;
  if (amount.trim().length > 0) {
    try {
      previewMinor = parseDollarsToMinor(amount.trim());
    } catch {
      previewMinor = null;
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const amountMinor = parseDollarsToMinor(amount.trim());
      if (!idempotencyKey.current) {
        idempotencyKey.current = `web-${crypto.randomUUID()}`;
      }
      const result = await paymentsApi.create(
        {
          beneficiaryName: beneficiaryName.trim(),
          beneficiaryReference: beneficiaryReference.trim() || undefined,
          amountMinor,
          memo: memo.trim() || undefined,
        },
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      setNotice(
        result.request.status === "COMPLETED"
          ? "Paid through the simulator and posted to the ledger."
          : "Request created. A different owner or admin must approve it.",
      );
      setBeneficiaryName("");
      setBeneficiaryReference("");
      setAmount("");
      setMemo("");
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-rise">
      <p className="eyebrow">Business account / payments</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
            Payments
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            {current.role === "EMPLOYEE"
              ? "Create a request for a vendor. An owner or admin must approve it, and you can never approve your own."
              : "Every request is created by a person and decided by a different person. Money moves only after approval."}
          </p>
        </div>
        <p className="border border-gold/40 bg-gold/[0.08] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7a5a17]">
          Simulated rail · no bank transfer
        </p>
      </div>

      {error ? (
        <Alert tone="error" label="Payments" className="mt-6">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" label="Payments" className="mt-6">
          {notice}
        </Alert>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
              {current.role === "EMPLOYEE" ? "Your requests" : "All requests"}
            </h2>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
              Newest first
            </p>
          </div>

          {requests === null ? (
            <div className="mt-3 space-y-px border border-rule bg-rule">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-20 animate-pulse bg-paper-raised"
                />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="mt-3 border border-rule bg-paper-raised p-5">
              <p className="font-heading text-[1.15rem] font-light text-ink">
                No payment requests yet.
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                The first request you create appears here with its status and
                approval history.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {requests.map((request) => {
                const status = paymentStatus(request.status);
                return (
                  <li key={request.id}>
                    <Link
                      href={`/dashboard/payments/${request.id}`}
                      className="flex flex-wrap items-start justify-between gap-3 py-4 transition-colors hover:bg-ink/[0.02]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] text-ink">
                          {request.beneficiaryName}
                        </p>
                        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                          {formatDate(request.createdAt)}
                          <span className="px-1.5 text-teal">·</span>
                          {request.createdBy?.username ??
                            request.createdBy?.email ??
                            "You"}
                          {request.beneficiaryReference ? (
                            <>
                              <span className="px-1.5 text-teal">·</span>
                              {request.beneficiaryReference}
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-[12px] tabular-nums text-ink">
                          {formatMinor(request.amountMinor, request.currency)}
                        </span>
                        <StatusPill label={status.label} tone={status.tone} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-heading text-[1.35rem] font-light tracking-[-0.02em] text-ink">
            New request
          </h2>
          <form
            onSubmit={create}
            className="mt-3 border border-rule bg-paper-raised p-4 sm:p-5"
          >
            <div className="flex flex-col gap-5">
              <Field
                label="Beneficiary"
                name="beneficiary-name"
                required
                maxLength={120}
                placeholder="Acme Supplies"
                value={beneficiaryName}
                onChange={(event) => setBeneficiaryName(event.target.value)}
              />
              <Field
                label="Reference"
                name="beneficiary-reference"
                optional
                maxLength={80}
                placeholder="INV-1042"
                value={beneficiaryReference}
                onChange={(event) =>
                  setBeneficiaryReference(event.target.value)
                }
              />
              <Field
                label="Amount in USD"
                name="payment-amount"
                inputMode="decimal"
                required
                placeholder="5000.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                hint={
                  previewMinor
                    ? `= ${previewMinor} minor units (integer cents)`
                    : "Two decimals at most; converted to integer cents."
                }
              />
              <Field
                label="Memo"
                name="payment-memo"
                optional
                maxLength={280}
                placeholder="Office chairs"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
              />
            </div>
            <div className="mt-5">
              <SubmitButton type="submit" loading={submitting}>
                Create request
              </SubmitButton>
            </div>
            <p className="mt-4 border-t border-rule pt-3 text-[11px] leading-relaxed text-ink-muted">
              The beneficiary is display data only. No full bank account number
              is collected, and this simulator never submits a real transfer.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
