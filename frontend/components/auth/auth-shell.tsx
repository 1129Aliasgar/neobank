import type { ReactNode } from "react";
import { SealMark, Wordmark } from "@/components/brand/wordmark";

/**
 * The two-panel frame shared by sign-in and registration.
 *
 * The left panel is the bank's statement of intent; the right panel is the
 * clerk's desk. Keeping them visually distinct means a form never competes
 * with the brand for attention.
 */
export function AuthShell({
  eyebrow,
  title,
  lede,
  children,
  footer,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-[1.02fr_1fr]">
      <aside className="ink-wash relative hidden flex-col justify-between overflow-hidden px-12 py-12 text-paper lg:flex xl:px-16">
        <div className="relative z-10">
          <Wordmark tone="paper" withTagline />
        </div>

        <div className="relative z-10 max-w-[34rem] animate-rise">
          <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.3em] text-teal-bright">
            Business onboarding · KYB
          </p>
          <h1 className="font-heading text-[clamp(2.9rem,4.4vw,4.6rem)] leading-[0.94] font-light tracking-[-0.02em] text-paper">
            A business account,
            <br />
            <span className="italic text-paper/70">properly opened.</span>
          </h1>
          <p className="mt-7 max-w-md text-[15px] leading-[1.7] text-paper/55">
            Register the company, record its details, then verify it against the
            registry. Every step is kept on the record — no shortcuts, no
            screenshots of passports in our database.
          </p>
        </div>

        <div className="relative z-10 flex items-end justify-between gap-6">
          <div className="max-w-[15rem]">
            <div className="mb-4 h-px w-12 bg-teal-bright/60" />
            <p className="font-mono text-[9px] leading-relaxed uppercase tracking-[0.18em] text-paper/35">
              Identity checks are performed by Didit. Documents stay with the
              verification provider.
            </p>
          </div>
          <SealMark
            tone="paper"
            className="h-24 w-24 shrink-0 text-paper opacity-[0.14]"
          />
        </div>

        {/* A faint ruled field, like the reverse of a ledger page. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 47px, var(--paper) 47px, var(--paper) 48px)",
          }}
        />
      </aside>

      <main className="flex flex-col px-6 pb-10 pt-8 sm:px-10 lg:px-14 xl:px-20">
        <div className="lg:hidden">
          <Wordmark withTagline />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[26rem] animate-rise">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="mt-4 font-heading text-[2.6rem] leading-[1.02] font-light tracking-[-0.015em] text-ink">
              {title}
            </h2>
            <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-ink-muted">
              {lede}
            </p>

            <div className="mt-9">{children}</div>

            {footer ? <div className="mt-8">{footer}</div> : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-rule pt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted/70">
            © NeoBank 2026
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted/70">
            <span aria-hidden="true" className="size-1 rounded-full bg-gold" />
            Sandbox environment
          </span>
        </div>
      </main>
    </div>
  );
}
