"use client";

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "quiet";

const variants: Record<Variant, string> = {
  primary:
    "bg-ink text-paper-raised hover:bg-teal focus-visible:bg-teal disabled:hover:bg-ink",
  outline:
    "border border-ink/25 bg-transparent text-ink hover:border-ink hover:bg-ink/[0.04]",
  quiet:
    "border-b border-rule bg-transparent text-ink hover:border-teal hover:text-teal",
};

export interface SubmitButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: Variant;
  /** Rendered on the right; the arrow is the default for primary actions. */
  adornment?: ReactNode;
}

export function SubmitButton({
  children,
  loading = false,
  variant = "primary",
  adornment,
  className,
  disabled,
  type = "submit",
  ...props
}: SubmitButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "group inline-flex h-12 w-full items-center justify-between gap-4 px-4 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant],
        className,
      )}
    >
      <span className="flex items-center gap-3">
        {loading ? (
          <span aria-hidden="true" className="flex items-center gap-1">
            <span className="size-1 animate-pulse rounded-full bg-current" />
            <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
            <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
          </span>
        ) : null}
        {children}
      </span>
      <span
        aria-hidden="true"
        className="text-base leading-none transition-transform duration-200 group-hover:translate-x-1"
      >
        {loading ? "" : (adornment ?? "→")}
      </span>
    </button>
  );
}

/** Inline text action for destructive/primary links that must not look like a form. */
export function TextLink({
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.18em] text-teal underline decoration-teal/30 underline-offset-4 transition-colors hover:decoration-teal",
        className,
      )}
    >
      {children}
    </a>
  );
}
