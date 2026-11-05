"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import {
  cardsApi,
  type CardAuthorization,
  type CardView,
} from "@/lib/cards";
import { formatMinor, parseDollarsToMinor } from "@/lib/money";
import type { CurrentBusiness } from "@/lib/business";

export default function CardDetailRoute() {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-16 text-[13px] text-ink-muted">
          Loading card…
        </div>
      }
    >
      <CardDetailGate />
    </Suspense>
  );
}

function CardDetailGate() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "OPERATIONS" ? (
          <Refusal role={current.role} />
        ) : (
          <DashboardShell current={current}>
            <CardDetail current={current} />
          </DashboardShell>
        )
      }
    </OnboardingGate>
  );
}

function CardDetail({ current }: { current: CurrentBusiness }) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const operator = current.role === "OWNER" || current.role === "ADMIN";

  const [card, setCard] = useState<CardView | null>(null);
  const [activity, setActivity] = useState<CardAuthorization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("18.42");
  const [descriptor, setDescriptor] = useState("NEOBANK SANDBOX CAFE");
  const [settleAmount, setSettleAmount] = useState("");

  const refresh = useCallback(async () => {
    const [nextCard, nextActivity] = await Promise.all([
      cardsApi.get(id),
      cardsApi.authorizations(id),
    ]);
    setCard(nextCard);
    setActivity(nextActivity);
  }, [id]);

  useEffect(() => {
    let active = true;

    void Promise.all([cardsApi.get(id), cardsApi.authorizations(id)])
      .then(([nextCard, nextActivity]) => {
        if (active) {
          setCard(nextCard);
          setActivity(nextActivity);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Could not load this card.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  async function authorize() {
    if (!card) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await cardsApi.simulateAuthorize(card.id, {
        amountMinor: parseDollarsToMinor(amount),
        descriptor,
      });
      setNotice(
        `Authorization accepted · webhook ${result.outcome} · transaction ${result.transactionToken.slice(0, 8)}…`,
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not authorize.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function settle(row: CardAuthorization) {
    if (!card) {
      return;
    }

    const remaining = BigInt(row.amountMinor) - BigInt(row.capturedMinor);

    if (remaining <= BigInt(0)) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    let requested = remaining.toString();

    if (settleAmount.trim()) {
      try {
        requested = parseDollarsToMinor(settleAmount.trim());
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Enter a valid settle amount.",
        );
        setBusy(false);
        return;
      }
    }

    try {
      const result = await cardsApi.simulateClear(card.id, {
        transactionToken: row.providerAuthorizationId,
        amountMinor: requested,
      });
      setNotice(
        `Clearing accepted · webhook ${result.outcome} · ledger capture posted.`,
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not clear the card.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function voidAuthorization(row: CardAuthorization) {
    if (!card) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await cardsApi.simulateVoid(card.id, {
        transactionToken: row.providerAuthorizationId,
      });
      setNotice(`Void accepted · webhook ${result.outcome} · hold released.`);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not void the hold.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!card) {
    return (
      <div className="animate-rise">
        <p className="eyebrow">Cards / activity</p>
        <h1 className="mt-4 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
          Card
        </h1>
        {error ? (
          <p
            role="alert"
            className="mt-6 border-l-2 border-vermilion py-2 pl-3 text-[13px] text-vermilion"
          >
            {error}
          </p>
        ) : (
          <p className="mt-6 text-[13px] text-ink-muted">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <Link
        href={operator ? "/dashboard/cards" : "/dashboard/card"}
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted hover:text-ink"
      >
        ← {operator ? "All cards" : "My card"}
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Cards / activity</p>
          <h1 className="mt-3 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
            •••• {card.last4 ?? "----"}
          </h1>
          <p className="mt-2 text-[13px] text-ink-muted">
            {card.employee?.email ?? "Unassigned"} ·{" "}
            {card.spendingLimitMinor
              ? `${formatMinor(card.spendingLimitMinor, card.currency)} ${card.spendingLimitInterval?.toLowerCase() ?? ""}`
              : "No spend limit"}{" "}
            · exp{" "}
            {card.expMonth && card.expYear
              ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
              : "—"}
          </p>
          <p className="mt-2 break-all font-mono text-[10px] tracking-[0.08em] text-ink-muted/80">
            Lithic card {card.providerCardId}
          </p>
        </div>
        <span className="border border-rule px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">
          {card.status} · Lithic Sandbox
        </span>
      </div>

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

      {operator ? (
        <section className="mt-8 border border-rule bg-paper-raised p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Sandbox simulator</p>
              <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-ink-muted">
                Calls Lithic&apos;s Sandbox authorization endpoint, then signs
                and delivers a webhook through the same ingress a live event
                uses. Not a production payment. Leave the settle amount blank
                to release the remaining hold, or enter a different amount to
                demonstrate a tip/fuel-style over-capture.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-[11px] text-ink-muted">
                Amount (USD)
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  className="w-28 border border-rule bg-paper px-3 py-2 text-ink"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-ink-muted">
                Merchant
                <input
                  value={descriptor}
                  onChange={(event) => setDescriptor(event.target.value)}
                  className="w-52 border border-rule bg-paper px-3 py-2 text-ink"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-ink-muted">
                Settle amount (USD)
                <input
                  value={settleAmount}
                  onChange={(event) => setSettleAmount(event.target.value)}
                  placeholder="remaining"
                  inputMode="decimal"
                  className="w-32 border border-rule bg-paper px-3 py-2 text-ink placeholder:text-ink-muted/50"
                />
              </label>
              <button
                onClick={() => void authorize()}
                disabled={busy || card.status !== "ACTIVE"}
                className="bg-ink px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper disabled:opacity-40"
              >
                {busy ? "Working…" : "Authorize"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <p className="eyebrow">Authorizations and ledger movement</p>
        <div className="mt-4 border-y border-rule">
          {activity.map((row) => {
            const remaining =
              BigInt(row.amountMinor) - BigInt(row.capturedMinor);
            let requested = remaining.toString();

            if (settleAmount.trim()) {
              try {
                requested = parseDollarsToMinor(settleAmount.trim());
              } catch {
                /* Keep the row's remaining amount until the input is valid. */
              }
            }

            return (
              <div key={row.id} className="border-b border-rule py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] text-ink">
                      {row.merchantName ?? "Card authorization"}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                      {row.status} ·{" "}
                      {new Date(row.createdAt).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] text-ink">
                      {formatMinor(row.amountMinor, row.currency)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      captured {formatMinor(row.capturedMinor, row.currency)}
                    </p>
                  </div>
                </div>

                {row.transactions.length ? (
                  <div className="mt-3 grid gap-1">
                    {row.transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between text-[11px] text-ink-muted"
                      >
                        <span className="font-mono uppercase tracking-[0.12em]">
                          {transaction.kind}
                        </span>
                        <span>
                          {formatMinor(
                            transaction.amountMinor,
                            transaction.currency,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {operator && remaining > BigInt(0) &&
                (row.status === "APPROVED" ||
                  row.status === "PARTIALLY_CAPTURED") ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void settle(row)}
                      disabled={busy}
                      className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink disabled:opacity-40"
                    >
                      Settle {formatMinor(requested, row.currency)}
                    </button>
                    <button
                      onClick={() => void voidAuthorization(row)}
                      disabled={busy}
                      className="border border-vermilion/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-vermilion disabled:opacity-40"
                    >
                      Void hold
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!activity.length ? (
            <p className="py-10 text-[13px] text-ink-muted">
              No card activity yet. An authorization creates a hold; clearing
              converts it into a ledger capture.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
