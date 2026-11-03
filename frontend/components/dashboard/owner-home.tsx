"use client";

import type { CurrentBusiness } from "@/lib/business";
import { formatDate, isOperator } from "@/lib/dashboard";
import { useDashboardSession } from "@/lib/dashboard-session";
import { RoleBadge } from "./role-badge";
import { StatusPill } from "@/components/ui/alert";
import { businessStatus } from "@/lib/dashboard";

const PLACEHOLDERS = [
  { label: "Balance", verb: "Opens in", module: "Module 3", mark: "01" },
  { label: "Team", verb: "Managed in", module: "Module 2b", mark: "02" },
  { label: "Cards", verb: "Issued in", module: "Module 4", mark: "03" },
];

export function OwnerHome({ current }: { current: CurrentBusiness }) {
  const { user, identityError } = useDashboardSession();
  const status = businessStatus(current.business.status);

  if (!isOperator(current.role)) {
    return null;
  }

  return (
    <div className="animate-rise">
      <p className="eyebrow">Business account / overview</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-5 border-b border-rule pb-6">
        <div className="min-w-0">
          <h1 className="max-w-3xl break-words font-heading text-[clamp(2.15rem,5vw,3.65rem)] font-light leading-[1.02] tracking-[-0.035em] text-ink">
            {current.business.legalName}
          </h1>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
            Business account <span className="px-1.5 text-teal">·</span> {current.business.currency}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 pb-0.5">
          <RoleBadge role={current.role} />
          <StatusPill label={status.label} tone={status.tone} />
        </div>
      </div>

      <section aria-label="Business account areas" className="mt-7 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-3">
        {PLACEHOLDERS.map((item) => (
          <article key={item.label} className="paper-emboss min-h-40 p-5 sm:p-6">
            <p className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted/75">
              {item.label}
              <span className="text-teal/65">{item.mark}</span>
            </p>
            <p className="mt-8 font-heading text-[1.35rem] font-light leading-none tracking-[-0.02em] text-ink">
              {item.verb}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-teal">
              {item.module}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-5 border-t border-rule pt-5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.65fr)]">
        <div>
          <p className="eyebrow">Your access</p>
          <p className="mt-3 text-[13px] text-ink">
            {user?.email ?? (identityError ? "Profile details unavailable" : "Reading your profile…")}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            {current.role} <span className="px-1 text-teal">·</span> member since {formatDate(user?.createdAt)}
          </p>
          {identityError ? <p role="status" className="mt-2 text-[11px] text-vermilion">{identityError}</p> : null}
        </div>
        <p className="max-w-sm text-[11px] leading-relaxed text-ink-muted sm:justify-self-end">
          This workspace is a sandbox. No real money moves through this account.
        </p>
      </section>
    </div>
  );
}
