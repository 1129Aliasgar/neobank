"use client";

import { Wordmark } from "@/components/brand/wordmark";
import { useSignOut } from "@/lib/session";
import type { UserRole } from "@/lib/auth";

export function Refusal({ role }: { role: UserRole }) {
  const signOut = useSignOut();

  return (
    <main className="flex min-h-svh flex-col bg-paper">
      <header className="flex items-center justify-between gap-4 border-b border-rule bg-paper-raised px-5 py-4 sm:px-8">
        <Wordmark />
        <button
          type="button"
          onClick={() => void signOut()}
          className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-teal"
        >
          Sign out
        </button>
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-16 sm:px-8">
        <p className="eyebrow">{role}</p>
        <h1 className="mt-4 font-heading text-[clamp(2.25rem,6vw,4rem)] font-light leading-[1.02] tracking-[-0.035em] text-ink">
          This area is for business accounts.
        </h1>
      </section>
    </main>
  );
}
