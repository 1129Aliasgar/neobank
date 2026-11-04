"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import { cardsApi, type CardView, type EmployeeOption } from "@/lib/cards";
import { parseDollarsToMinor, formatMinor } from "@/lib/money";
import { ApiClientError } from "@/lib/api";

const INTERVALS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "TRANSACTION", label: "Per transaction" },
  { value: "ANNUALLY", label: "Annually" },
  { value: "FOREVER", label: "No reset" },
] as const;

export default function CardsPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OWNER" || current.role === "ADMIN" ? (
          <DashboardShell current={current}>
            <CardsContent />
          </DashboardShell>
        ) : (
          <Refusal role={current.role} />
        )
      }
    </OnboardingGate>
  );
}

function CardsContent() {
  const [cards, setCards] = useState<CardView[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employee, setEmployee] = useState("");
  const [limit, setLimit] = useState("500");
  const [interval, setIntervalValue] = useState("MONTHLY");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.all([cardsApi.list(), cardsApi.employees()])
      .then(([nextCards, nextEmployees]) => {
        if (active) {
          setCards(nextCards);
          setEmployees(nextEmployees);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Could not load cards.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function issue(event: React.FormEvent) {
    event.preventDefault();

    if (!employee) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const card = await cardsApi.issue({
        userId: employee,
        spendingLimitMinor: parseDollarsToMinor(limit),
        spendingLimitInterval: interval,
      });
      setCards((rows) => [card, ...rows.filter((row) => row.id !== card.id)]);
      setNotice("Virtual card issued in Lithic Sandbox.");
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : "Could not issue the card.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function change(
    card: CardView,
    action: "freeze" | "unfreeze" | "cancel",
  ) {
    setError(null);

    try {
      const next = await cardsApi[action](card.id);
      setCards((rows) =>
        rows.map((row) => (row.id === card.id ? next : row)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update the card.",
      );
    }
  }

  return (
    <div className="animate-rise">
      <p className="eyebrow">Business account / issuing</p>
      <h1 className="mt-4 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
        Cards
      </h1>
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
        Issue virtual cards in Lithic Sandbox. NeoBank owns the employee
        assignment, controls and ledger connection.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 border-l-2 border-vermilion py-2 pl-3 text-[13px] text-vermilion"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-6 border-l-2 border-teal py-2 pl-3 text-[13px] text-teal"
        >
          {notice}
        </p>
      ) : null}

      <form
        onSubmit={issue}
        className="mt-8 grid gap-4 border-y border-rule py-6 lg:grid-cols-[1.5fr_1fr_1fr_auto] lg:items-end"
      >
        <label className="grid gap-2 text-[12px] text-ink-muted">
          Employee
          <select
            value={employee}
            onChange={(event) => setEmployee(event.target.value)}
            className="border border-rule bg-paper-raised px-3 py-2.5 text-ink"
          >
            <option value="">Select employee</option>
            {employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.username} · {row.email}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-[12px] text-ink-muted">
          Limit (USD)
          <input
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            inputMode="decimal"
            className="border border-rule bg-paper-raised px-3 py-2.5 text-ink"
          />
        </label>
        <label className="grid gap-2 text-[12px] text-ink-muted">
          Limit interval
          <select
            value={interval}
            onChange={(event) => setIntervalValue(event.target.value)}
            className="border border-rule bg-paper-raised px-3 py-2.5 text-ink"
          >
            {INTERVALS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !employee}
          className="bg-ink px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper disabled:opacity-40"
        >
          {busy ? "Issuing…" : "Issue card"}
        </button>
      </form>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <article
            key={card.id}
            className="border border-rule bg-paper-raised p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                  {card.employee?.email ?? "Unassigned"}
                </p>
                <p className="mt-4 font-heading text-2xl tracking-[-0.02em] text-ink">
                  •••• {card.last4 ?? "----"}
                </p>
              </div>
              <span className="border border-rule px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">
                {card.status}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-rule pt-4 text-[12px]">
              <div>
                <p className="text-ink-muted">Limit</p>
                <p className="mt-1 text-ink">
                  {card.spendingLimitMinor
                    ? formatMinor(card.spendingLimitMinor, card.currency)
                    : "No limit"}
                </p>
              </div>
              <div>
                <p className="text-ink-muted">Provider</p>
                <p className="mt-1 text-ink">Lithic Sandbox</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href={`/dashboard/cards/${card.id}`}
                className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
              >
                Activity
              </Link>
              {card.status === "ACTIVE" ? (
                <button
                  onClick={() => void change(card, "freeze")}
                  className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
                >
                  Freeze
                </button>
              ) : card.status === "INACTIVE" ? (
                <button
                  onClick={() => void change(card, "unfreeze")}
                  className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
                >
                  Unfreeze
                </button>
              ) : null}
              <button
                onClick={() => void change(card, "cancel")}
                disabled={card.status === "CANCELED"}
                className="border border-vermilion/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-vermilion disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </article>
        ))}
        {!cards.length && !error ? (
          <p className="border border-dashed border-rule px-5 py-12 text-[13px] text-ink-muted md:col-span-2">
            No cards yet. Issue one for an active employee to begin the Sandbox
            card loop.
          </p>
        ) : null}
      </div>
    </div>
  );
}
