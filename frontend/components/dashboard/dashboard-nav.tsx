"use client";

import Link from "next/link";
import type { NavItem } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { NavIcon } from "./icons";

/**
 * The sidebar rail.
 *
 * A live item is a link. A deferred item is a plain row with its module tag:
 * rendering it as a disabled button would still invite a click, and inventing
 * a route that does not exist is the kind of half-built surface the brief
 * warns about.
 */
export function DashboardNav({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <p className="hidden px-3 pb-2 font-mono text-[9px] uppercase tracking-[0.24em] text-ink-muted/60 lg:block">
        Workspace
      </p>

      <ul className="flex min-w-0 gap-1 overflow-x-auto border-b border-rule pb-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-0 lg:pb-0">
        {items.map((item) => {
          const active =
            item.href !== undefined &&
            (item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href));

          return (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={item.hint}
                  className={cn(
                    "relative flex shrink-0 items-center gap-2.5 rounded-sm px-3 py-2.5 text-[12px] transition-colors duration-150 lg:w-full lg:gap-3 lg:text-[13px]",
                    active
                      ? "bg-ink/[0.045] font-medium text-ink"
                      : "text-ink-muted hover:bg-ink/[0.025] hover:text-ink",
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-teal"
                    />
                  ) : null}
                  <NavIcon
                    name={item.icon}
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-teal" : "text-ink-muted/75",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {item.badge ? (
                    <span
                      aria-label={`${item.badge} pending`}
                      className="ml-auto min-w-5 shrink-0 bg-vermilion px-1.5 py-0.5 text-center font-mono text-[9px] leading-none text-paper-raised"
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              ) : (
                <div
                  aria-disabled="true"
                  title={item.hint}
                  className="flex shrink-0 cursor-default items-center gap-2.5 rounded-sm px-3 py-2.5 text-[12px] text-ink-muted/50 select-none lg:w-full lg:gap-3 lg:text-[13px]"
                >
                  <NavIcon
                    name={item.icon}
                    className="size-4 shrink-0 text-ink-muted/35"
                  />
                  <span className="truncate">{item.label}</span>
                  {item.module ? (
                    <span className="ml-auto shrink-0 border border-rule px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted/55">
                      {item.module}
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
