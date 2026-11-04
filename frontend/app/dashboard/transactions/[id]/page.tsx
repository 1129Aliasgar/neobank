"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { accountApi, type Transaction } from "@/lib/account";
import { formatMinor } from "@/lib/money";
export default function TransactionPage() {
  return (
    <Suspense fallback={<div className="min-h-svh bg-paper" />}>
      <TransactionRoute />
    </Suspense>
  );
}
function TransactionRoute() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "EMPLOYEE" || current.role === "OPERATIONS" ? (
          <Refusal role={current.role} />
        ) : (
          <DashboardShell current={current}>
            <Detail id={id} />
          </DashboardShell>
        )
      }
    </OnboardingGate>
  );
}
function Detail({ id }: { id: string }) {
  const [row, setRow] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void accountApi
      .transaction(id)
      .then(setRow)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Could not load the transaction.",
        ),
      );
  }, [id]);
  if (error)
    return (
      <p role="alert" className="text-[13px] text-vermilion">
        {error}
      </p>
    );
  if (!row)
    return (
      <div className="h-52 animate-pulse border border-rule bg-paper-raised" />
    );
  return (
    <div className="animate-rise">
      <p className="eyebrow">Ledger receipt / {row.kind}</p>
      <h1 className="mt-4 font-heading text-[clamp(2rem,5vw,3.5rem)] font-light tracking-[-0.035em] text-ink">
        {formatMinor(row.amountMinor, row.currency)}
      </h1>
      <p className="mt-3 text-[13px] text-ink-muted">
        {row.description} · {row.status}
      </p>
      <section className="mt-8 border border-rule bg-paper-raised">
        <div className="border-b border-rule px-5 py-4 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
          Journal lines
        </div>
        {row.lines.map((line) => (
          <div
            key={`${line.accountCode}-${line.direction}`}
            className="flex flex-wrap justify-between gap-4 border-b border-rule/70 px-5 py-4 last:border-0"
          >
            <span className="text-[13px] text-ink">
              {line.accountCode} · {line.accountName}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              {line.direction} · {formatMinor(line.amountMinor, row.currency)}
            </span>
          </div>
        ))}
      </section>
      <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
        Ledger entries are permanent. Corrections are posted as reversals.
      </p>
    </div>
  );
}
