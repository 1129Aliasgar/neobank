"use client";

import type { CurrentBusiness } from "@/lib/business";
import { useDashboardSession } from "@/lib/dashboard-session";
import { RoleBadge } from "./role-badge";

export function EmployeeHome({ current }: { current: CurrentBusiness }) {
  const { user, identityError } = useDashboardSession();

  return (
    <div className="animate-rise">
      <p className="eyebrow">Personal account</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-5 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="max-w-3xl break-words font-heading text-[clamp(2.15rem,5vw,3.65rem)] font-light leading-[1.02] tracking-[-0.035em] text-ink">
            {current.business.legalName}
          </h1>
          <p className="mt-3 text-[13px] text-ink-muted">
            You’re a member of this organisation.
          </p>
        </div>
        <RoleBadge role={current.role} />
      </div>

      <section className="mt-7 border border-rule bg-paper-raised p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <p className="eyebrow">Your card</p>
          <span aria-hidden="true" className="grid size-9 place-items-center border border-rule text-teal">
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2.8" y="5" width="18.4" height="14" rx="1.6" />
              <path d="M2.8 10h18.4M6 15.2h3.5" />
            </svg>
          </span>
        </div>
        <p className="mt-7 max-w-xl font-heading text-[clamp(1.45rem,3vw,2rem)] font-light leading-tight tracking-[-0.02em] text-ink">
          A virtual card will appear here once your admin issues one.
        </p>
        <p className="mt-3 max-w-lg text-[12px] leading-relaxed text-ink-muted">
          Spending limit and your transactions will live on this page.
        </p>
      </section>

      <section className="mt-7 border-t border-rule pt-5">
        <p className="eyebrow">Your details</p>
        <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
          <dd className="min-w-0 break-all text-ink">
            {user?.email ?? (identityError ? "Profile details unavailable" : "Reading your profile…")}
          </dd>
          <dd className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            {current.role} <span className="px-1 text-teal">·</span> {current.business.currency}
          </dd>
        </dl>
        {identityError ? <p role="status" className="mt-2 text-[11px] text-vermilion">{identityError}</p> : null}
      </section>
    </div>
  );
}
