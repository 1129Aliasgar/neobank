"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { StatusPill } from "@/components/ui/alert";
import { useSignOut } from "@/lib/session";
import { businessStatus, navForRole } from "@/lib/dashboard";
import type { CurrentBusiness } from "@/lib/business";
import { DashboardSessionProvider } from "@/lib/dashboard-session";
import { DashboardNav } from "./dashboard-nav";

export function DashboardShell({
  current,
  children,
}: {
  current: CurrentBusiness;
  children: ReactNode;
}) {
  const signOut = useSignOut();
  const pathname = usePathname();
  const status = businessStatus(current.business.status);

  return (
    <DashboardSessionProvider current={current}>
      <div className="min-h-svh bg-paper">
        <header className="border-b border-rule bg-paper-raised">
          <div className="mx-auto flex min-h-[4.5rem] max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-7 lg:px-10">
            <Wordmark />
            <div className="flex min-w-0 items-center gap-3 sm:gap-5">
              <p className="hidden max-w-[15rem] truncate font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted sm:block">
                {current.business.legalName}
              </p>
              <StatusPill label={status.label} tone={status.tone} />
              <button
                type="button"
                onClick={() => void signOut()}
                className="border-l border-rule pl-3 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-teal sm:pl-5"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-7 sm:py-9 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12 lg:px-10 lg:py-12">
          <aside className="min-w-0 lg:pt-1">
            <DashboardNav items={navForRole(current.role)} pathname={pathname} />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </DashboardSessionProvider>
  );
}
