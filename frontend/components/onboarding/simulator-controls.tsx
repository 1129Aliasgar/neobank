"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusPill } from "@/components/ui/alert";
import type { CurrentBusiness } from "@/lib/business";
import { verificationLabel, verificationTone } from "@/lib/status";
import { verificationApi, type SimulatorScenario } from "@/lib/verification";

const SCENARIOS: ReadonlyArray<{
  value: SimulatorScenario;
  label: string;
  providerStatus: string;
  description: string;
}> = [
  {
    value: "approve",
    label: "Approve",
    providerStatus: "Approved",
    description: "Registry matches. The business becomes ACTIVE.",
  },
  {
    value: "decline",
    label: "Decline",
    providerStatus: "Declined",
    description: "A refusal. The business may retry with corrections.",
  },
  {
    value: "review",
    label: "Manual review",
    providerStatus: "In Review",
    description: "Park the file for a human; no duplicate session allowed.",
  },
  {
    value: "pending",
    label: "Leave pending",
    providerStatus: "In Progress",
    description: "The check continues; nothing terminal is written.",
  },
  {
    value: "awaiting_user",
    label: "Awaiting user",
    providerStatus: "Awaiting User",
    description: "Marks the attempt as needing applicant action.",
  },
  {
    value: "abandon",
    label: "Abandon",
    providerStatus: "Abandoned",
    description: "Applicant walked away. Closes the attempt, keeps it retryable.",
  },
  {
    value: "expire",
    label: "Expire",
    providerStatus: "Expired",
    description: "The hosted link timed out. Closes the attempt.",
  },
];

export function SimulatorControls({ current }: { current: CurrentBusiness }) {
  const router = useRouter();
  const [working, setWorking] = useState<SimulatorScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verification = current.onboarding.verification;
  const canSimulate =
    verification !== null &&
    verification.provider === "SIMULATOR" &&
    verification.status !== "APPROVED" &&
    verification.status !== "REJECTED";

  async function choose(scenario: SimulatorScenario) {
    setWorking(scenario);
    setError(null);

    try {
      await verificationApi.simulate(scenario);
      router.push("/onboarding/status");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The sandbox could not apply that outcome.",
      );
      setWorking(null);
    }
  }

  return (
    <div className="max-w-4xl">
      {error ? (
        <Alert tone="error" label="Sandbox refused" className="mb-6">
          {error}
        </Alert>
      ) : null}

      <div className="mb-7 border-l-2 border-gold/50 py-1 pl-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#7a5a17]">
          Local simulator · development only
        </p>
        <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-muted">
          This console exists only when the API runs with{" "}
          <span className="font-mono text-[11px]">
            VERIFICATION_PROVIDER=simulator
          </span>
          . It drives the same transition function as a Didit webhook, and the
          decision is recorded as a SIMULATOR / SANDBOX attempt.
        </p>
      </div>

      {verification ? (
        <div className="mb-7 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-rule py-3">
          <StatusPill
            label={verificationLabel(verification.status)}
            tone={verificationTone(verification.status)}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            Attempt {verification.attemptNumber}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            Provider status · {verification.providerStatus ?? "—"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            Provider · {verification.provider}
          </span>
        </div>
      ) : null}

      {!canSimulate ? (
        <div className="max-w-lg">
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            {verification
              ? verification.provider !== "SIMULATOR"
                ? "The active attempt was created by Didit, so the local simulator has nothing to decide. Use the hosted session instead."
                : "This attempt is already closed. Start a new attempt before choosing an outcome."
              : "There is no attempt to decide yet. Start verification first."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.push("/onboarding/verify")}
              className="inline-flex h-11 items-center border border-ink/25 px-5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-ink hover:bg-ink/[0.04]"
            >
              Go to verification
            </button>
            <button
              type="button"
              onClick={() => router.push("/onboarding/status")}
              className="inline-flex h-11 items-center px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted transition-colors hover:text-teal"
            >
              View record
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="eyebrow mb-4">Choose the provider&apos;s answer</p>
          <div className="grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.map((scenario, index) => (
              <button
                key={scenario.value}
                type="button"
                disabled={working !== null}
                onClick={() => void choose(scenario.value)}
                className="group flex min-h-36 flex-col justify-between bg-paper-raised p-4 text-left transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[9px] tabular-nums tracking-[0.14em] text-teal">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-muted/60">
                    {scenario.providerStatus}
                  </span>
                </div>
                <div>
                  <span className="mt-4 block font-heading text-xl leading-none text-ink">
                    {working === scenario.value ? "Applying…" : scenario.label}
                  </span>
                  <span className="mt-2 block text-[11.5px] leading-relaxed text-ink-muted">
                    {scenario.description}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="mt-4 block h-px w-full bg-rule transition-colors group-hover:bg-teal"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
