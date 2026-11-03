"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import type { OnboardingStep } from "@/lib/auth";
import { routeForStep, type CurrentBusiness } from "@/lib/business";
import { useCurrentBusiness } from "@/lib/session";

/** A quiet page-fill used while the API is being read. */
export function LedgerLoader({ label = "Opening the file" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <div
        aria-hidden="true"
        className="h-px w-24 overflow-hidden bg-rule"
      >
        <div className="h-px w-1/2 animate-pulse bg-teal" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted">
        {label}
      </p>
    </div>
  );
}

/**
 * Reads the authoritative onboarding state and parks the user on the one page
 * that matches it. The allowed list is the only thing a page declares; the
 * redirect target comes from the server's `nextStep`, so the client never
 * invents an order of operations.
 */
export function OnboardingGate({
  allow,
  children,
}: {
  allow: OnboardingStep[];
  children: (current: CurrentBusiness) => ReactNode;
}) {
  const router = useRouter();
  const { data, loading, error, reload } = useCurrentBusiness();

  const allowed = data ? allow.includes(data.onboarding.nextStep) : false;

  useEffect(() => {
    if (data && !allowed) {
      router.replace(routeForStep(data.onboarding.nextStep));
    }
  }, [allowed, data, router]);

  if (error) {
    return (
      <div className="max-w-md">
        <Alert label="Could not load the file">{error}</Alert>
        <div className="mt-5 max-w-48">
          <SubmitButton
            type="button"
            variant="outline"
            onClick={() => void reload()}
          >
            Try again
          </SubmitButton>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return <LedgerLoader />;
  }

  if (!allowed) {
    return <LedgerLoader label="Taking you to the right step" />;
  }

  return <>{children(data)}</>;
}
