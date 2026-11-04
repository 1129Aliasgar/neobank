"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { StatusPill } from "@/components/ui/alert";
import { useSignOut } from "@/lib/session";
import { businessStatus, isOperator, navForRole } from "@/lib/dashboard";
import type { CurrentBusiness } from "@/lib/business";
import { paymentsApi } from "@/lib/payments";
import {
  DashboardSessionProvider,
  useDashboardSession,
} from "@/lib/dashboard-session";
import { DashboardNav } from "./dashboard-nav";
import { CloseIcon, MenuIcon } from "./icons";
import { ProfileMenu } from "./profile-menu";

/**
 * Top-bar identity.
 *
 * It lives inside `DashboardSessionProvider` because the signed-in person comes
 * from `/auth/me`, not from the organisation response. Keeping it separate from
 * the shell avoids re-fetching identity on every dashboard navigation.
 */
function TopbarIdentity({ current }: { current: CurrentBusiness }) {
  const signOut = useSignOut();
  const { user } = useDashboardSession();
  const status = businessStatus(current.business.status);
  const displayName = user?.username ?? current.business.legalName;

  return (
    <div className="flex min-w-0 items-center gap-3 sm:gap-5">
      <p className="hidden max-w-[15rem] truncate font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted lg:block">
        {current.business.legalName}
      </p>
      <span className="hidden sm:inline-flex">
        <StatusPill label={status.label} tone={status.tone} />
      </span>
      <p className="hidden max-w-[12rem] truncate text-[12px] text-ink sm:block">
        {displayName}
      </p>
      <ProfileMenu />
      <button
        type="button"
        onClick={() => void signOut()}
        className="border-l border-rule pl-3 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-teal sm:pl-5"
      >
        Sign out
      </button>
    </div>
  );
}

export function DashboardShell({
  current,
  children,
}: {
  current: CurrentBusiness;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  /*
   * The sidebar badge is a convenience, never an authorisation: the queue
   * endpoint itself refuses non-approvers. A failed read leaves the badge
   * absent rather than breaking navigation.
   */
  useEffect(() => {
    if (!isOperator(current.role)) {
      return;
    }

    let active = true;
    void paymentsApi
      .queue()
      .then((queue) => {
        if (active) {
          setPendingApprovals(queue.count);
        }
      })
      .catch(() => {
        if (active) {
          setPendingApprovals(0);
        }
      });

    return () => {
      active = false;
    };
  }, [current.role, pathname]);

  const navItems = navForRole(current.role, pendingApprovals);

  useEffect(() => {
    if (!navOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  return (
    <DashboardSessionProvider current={current}>
      <div className="min-h-svh bg-paper">
        <header className="sticky top-0 z-40 border-b border-rule bg-paper-raised/95 backdrop-blur">
          <div className="mx-auto flex min-h-[4.5rem] max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-7 lg:px-10">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label="Open navigation"
                aria-expanded={navOpen}
                aria-controls="dashboard-nav-drawer"
                className="grid size-9 place-items-center border border-rule text-ink-muted transition-colors hover:text-ink lg:hidden"
              >
                <MenuIcon className="size-5" />
              </button>
              <Wordmark />
            </div>
            <TopbarIdentity current={current} />
          </div>
        </header>

        {navOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-ink/35"
            />
            <div
              id="dashboard-nav-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
              className="absolute inset-y-0 left-0 w-[min(18rem,85vw)] overflow-y-auto border-r border-rule bg-paper-raised p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <Wordmark />
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close navigation"
                  className="grid size-9 place-items-center border border-rule text-ink-muted transition-colors hover:text-ink"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
              <div className="mt-8">
                <DashboardNav
                  items={navItems}
                  pathname={pathname}
                  onNavigate={() => setNavOpen(false)}
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-7 sm:py-9 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12 lg:px-10 lg:py-12">
          <aside className="hidden min-w-0 lg:block lg:pt-1">
            <DashboardNav items={navItems} pathname={pathname} />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </DashboardSessionProvider>
  );
}
