"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Refusal } from "@/components/dashboard/refusal";
import {
  cardsApi,
  type CardAuthorization,
  type CardView,
} from "@/lib/cards";
import { formatMinor } from "@/lib/money";

export default function MyCardPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) =>
        current.role === "EMPLOYEE" ? (
          <DashboardShell current={current}>
            <MyCardContent />
          </DashboardShell>
        ) : (
          <Refusal role={current.role} />
        )
      }
    </OnboardingGate>
  );
}

function MyCardContent() {
  const [card, setCard] = useState<CardView | null>(null);
  const [activity, setActivity] = useState<CardAuthorization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void cardsApi
      .mine()
      .then(({ cards, authorizations }) => {
        if (active) {
          setCard(cards[0] ?? null);
          setActivity(authorizations);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your card.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function freeze() {
    if (!card) {
      return;
    }

    try {
      setCard(await cardsApi.freeze(card.id));
      setNotice("Your card is frozen.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not freeze your card.",
      );
    }
  }

  return (
    <div className="animate-rise">
      <p className="eyebrow">Personal account / card</p>
      <h1 className="mt-4 font-heading text-[clamp(2.2rem,5vw,3.8rem)] font-light tracking-[-0.035em] text-ink">
        My card
      </h1>
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
        Your card details and spend are private to you. Business balances and
        other employees&apos; cards stay out of this view.
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

      {card ? (
        <>
          <section className="mt-8 max-w-xl border border-ink bg-ink p-6 text-paper">
            <div className="flex items-start justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/60">
                Lithic / virtual
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper/70">
                {card.status}
              </span>
            </div>
            <p className="mt-12 font-mono text-2xl tracking-[0.18em]">
              •••• •••• •••• {card.last4 ?? "----"}
            </p>
            <div className="mt-8 flex items-end justify-between text-[11px] text-paper/65">
              <span>{card.employee?.email}</span>
              <span>
                {card.expMonth && card.expYear
                  ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
                  : "Sandbox"}
              </span>
            </div>
          </section>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <p className="text-[13px] text-ink-muted">
              Limit:{" "}
              <span className="text-ink">
                {card.spendingLimitMinor
                  ? formatMinor(card.spendingLimitMinor, card.currency)
                  : "No limit"}
              </span>
            </p>
            {card.status === "ACTIVE" ? (
              <button
                onClick={() => void freeze()}
                className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted"
              >
                Freeze card
              </button>
            ) : null}
            <Link
              href={`/dashboard/cards/${card.id}`}
              className="border border-rule px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted hover:text-ink"
            >
              Full activity
            </Link>
          </div>

          <section className="mt-12">
            <p className="eyebrow">Your activity</p>
            <div className="mt-4 border-y border-rule">
              {activity.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-4 border-b border-rule py-3 text-[12px]"
                >
                  <div>
                    <p className="text-ink">
                      {row.merchantName ?? "Card authorization"}
                    </p>
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">
                      {row.status} ·{" "}
                      {new Date(row.createdAt).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                      })}
                    </p>
                  </div>
                  <p className="text-ink">
                    {formatMinor(row.amountMinor, row.currency)}
                  </p>
                </div>
              ))}
              {!activity.length ? (
                <p className="py-8 text-[13px] text-ink-muted">
                  No card activity yet.
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : !error ? (
        <p className="mt-8 border border-dashed border-rule px-5 py-12 text-[13px] text-ink-muted">
          No card has been issued to you yet. Ask an owner or admin.
        </p>
      ) : null}
    </div>
  );
}
