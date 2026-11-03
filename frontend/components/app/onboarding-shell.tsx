"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { StatusPill } from "@/components/ui/alert";
import { useSignOut } from "@/lib/session";
import { cn } from "@/lib/utils";

export type OnboardingStepNumber = 1 | 2 | 3;

const STEPS = [
  { number: 1, label: "The entity", href: "/onboarding/business" },
  { number: 2, label: "Verification", href: "/onboarding/verify" },
  { number: 3, label: "Decision", href: "/onboarding/status" },
] as const;

/**
 * The onboarding frame.
 *
 * The numbered rail is the product's map: three positions, always visible, so a
 * user who lands on step three from a webhook email still knows where they are.
 * It is not navigation — completed steps are not clickable links, because the
 * server decides what is reachable.
 */
export function OnboardingShell({
  step,
  businessName,
  status,
  children,
}: {
  step: OnboardingStepNumber;
  businessName?: string;
  status?: { label: string; tone?: "neutral" | "progress" | "positive" | "negative" | "attention" };
  children: ReactNode;
}) {
  const signOut = useSignOut();

  return (
    <div className="min-h-svh">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4 sm:py-5">
          <Link href="/onboarding/business" aria-label="NeoBank onboarding">
            <Wordmark />
          </Link>

          <div className="flex min-w-0 items-center gap-4">
            {businessName ? (
              <span className="hidden max-w-[18rem] truncate font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted sm:block">
                {businessName}
              </span>
            ) : null}
            {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="border-l border-rule pl-4 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted transition-colors hover:text-teal"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-8 sm:py-10 lg:grid-cols-[11rem_1fr] lg:gap-16 lg:py-14">
        <nav aria-label="Onboarding progress">
          <ol className="flex flex-row flex-wrap gap-4 lg:flex-col lg:gap-0">
            {STEPS.map((item) => {
              const state =
                item.number < step
                  ? "done"
                  : item.number === step
                    ? "current"
                    : "upcoming";

              return (
                <li
                  key={item.number}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "relative flex items-baseline gap-3 lg:flex-col lg:gap-2 lg:pb-7 lg:pl-5",
                    "lg:border-l",
                    state === "upcoming" ? "lg:border-rule" : "lg:border-teal/50",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums tracking-[0.14em]",
                      state === "current"
                        ? "text-teal"
                        : state === "done"
                          ? "text-teal/70"
                          : "text-ink-muted/45",
                    )}
                  >
                    {String(item.number).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.16em]",
                      state === "current"
                        ? "text-ink"
                        : state === "done"
                          ? "text-ink-muted"
                          : "text-ink-muted/45",
                    )}
                  >
                    {item.label}
                  </span>
                  {state === "current" ? (
                    <span
                      aria-hidden="true"
                      className="absolute -left-[5px] top-1 hidden size-[9px] rounded-full bg-teal ring-4 ring-paper lg:block"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

/** Page title used inside the onboarding column. */
export function OnboardingHeading({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-9">
      <p className="eyebrow">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-[clamp(2.1rem,4vw,3.1rem)] leading-[1.02] font-light tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {aside}
      </div>
      <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
        {lede}
      </p>
      <div className="rule-fade mt-7" />
    </div>
  );
}
