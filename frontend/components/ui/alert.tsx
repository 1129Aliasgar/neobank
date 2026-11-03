"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "error" | "success" | "info" | "warn";

const tones: Record<Tone, string> = {
  error: "border-vermilion/40 bg-vermilion/[0.06] text-vermilion",
  success: "border-teal/35 bg-teal/[0.06] text-teal",
  info: "border-ink/20 bg-ink/[0.035] text-ink",
  warn: "border-gold/45 bg-gold/[0.08] text-[#7a5a17]",
};

/** A margin note: reads as an annotation on the page rather than an alert card. */
export function Alert({
  tone = "error",
  label,
  children,
  className,
}: {
  tone?: Tone;
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "border-l-2 py-2.5 pl-3.5 pr-2 font-sans text-[13px] leading-relaxed animate-rise",
        tones[tone],
        className,
      )}
    >
      {label ? (
        <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.22em] opacity-80">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

type PillTone = "neutral" | "progress" | "positive" | "negative" | "attention";

const pillTones: Record<PillTone, { dot: string; text: string }> = {
  neutral: { dot: "bg-ink/35", text: "text-ink-muted" },
  progress: { dot: "bg-gold", text: "text-[#7a5a17]" },
  positive: { dot: "bg-teal", text: "text-teal" },
  negative: { dot: "bg-vermilion", text: "text-vermilion" },
  attention: { dot: "bg-gold", text: "text-[#7a5a17]" },
};

export function StatusPill({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: PillTone;
  className?: string;
}) {
  const styles = pillTones[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]",
        styles.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", styles.dot)}
      />
      {label}
    </span>
  );
}
