"use client";

import { useEffect, useRef, useState } from "react";
import { RoleBadge } from "./role-badge";
import { ChevronIcon, SignOutIcon } from "./icons";
import { StatusPill } from "@/components/ui/alert";
import { businessStatus, formatDate, initialsFor, roleLabel } from "@/lib/dashboard";
import { useDashboardSession } from "@/lib/dashboard-session";
import { useSignOut } from "@/lib/session";
import { cn } from "@/lib/utils";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted/70">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-[12px] text-ink">
        {children}
      </dd>
    </div>
  );
}

/**
 * The account seal in the top bar.
 *
 * The popup is the one place in the product that answers "who am I signed in
 * as" — role, organisation and member-since are read from the same two API
 * responses the rest of the dashboard uses. Nothing is inferred from a cached
 * flag or a URL parameter.
 */
export function ProfileMenu() {
  const { current, user, identityError } = useDashboardSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = initialsFor(user?.username ?? current.role);
  const displayName = user?.username ?? "Your account";
  const status = businessStatus(current.business.status);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-panel"
        aria-label="Open your account details"
        className="group flex items-center gap-1.5 rounded-full border border-rule/80 bg-paper-raised p-0.5 pr-1.5 transition-colors hover:border-ink/25"
      >
        <span className="grid size-8 place-items-center rounded-full bg-teal font-heading text-[12px] tracking-[0.04em] text-paper-raised">
          {initials}
        </span>
        <ChevronIcon
          className={cn(
            "size-3.5 text-ink-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id="account-panel"
          role="dialog"
          aria-label="Your account"
          className="absolute right-0 z-50 mt-2 w-[19.5rem] origin-top-right animate-menu border border-rule bg-paper-raised shadow-[0_28px_70px_-32px_rgba(20,25,26,0.55)]"
        >
          <div className="flex items-start gap-3 border-b border-rule px-4 py-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink font-heading text-[14px] tracking-[0.04em] text-paper-raised">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate font-heading text-[17px] leading-tight text-ink">
                {displayName}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] tracking-[0.03em] text-ink-muted">
                {user?.email ?? "Reading the register…"}
              </p>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted/70">
                {roleLabel(current.role)}
              </p>
            </div>
            <RoleBadge role={current.role} className="ml-auto mt-0.5" />
          </div>

          <dl className="space-y-2.5 px-4 py-4">
            <Detail label="Organisation">{current.business.legalName}</Detail>
            <Detail label="Member since">{formatDate(user?.createdAt)}</Detail>
            <Detail label="Account">
              <StatusPill
                label={status.label}
                tone={status.tone}
                className="justify-end"
              />
            </Detail>
          </dl>

          {identityError ? (
            <p className="border-t border-rule px-4 py-2.5 font-mono text-[9px] leading-relaxed tracking-wide text-vermilion">
              {identityError}
            </p>
          ) : null}

          <div className="border-t border-rule p-2">
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-left text-[12px] text-ink-muted transition-colors hover:bg-ink/[0.035] hover:text-ink"
            >
              <SignOutIcon className="size-4" />
              Sign out
            </button>
          </div>

          <p className="border-t border-rule px-4 py-2.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-muted/55">
            Sandbox environment · No real money moves
          </p>
        </div>
      ) : null}
    </div>
  );
}
