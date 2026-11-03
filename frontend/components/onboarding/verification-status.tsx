"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusPill } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CurrentBusiness } from "@/lib/business";
import { verificationApi } from "@/lib/verification";
import {
  formatTimestamp,
  scenarioLabel,
  verificationLabel,
  verificationTone,
} from "@/lib/status";
import type { VerificationSummary } from "@/lib/business";

const COPY: Record<
  VerificationSummary["status"],
  { title: string; body: string }
> = {
  NOT_STARTED: {
    title: "Awaiting your action",
    body: "The session was created but the hosted check was not completed. Reopen it to finish.",
  },
  PENDING: {
    title: "Under review",
    body: "The provider is checking the company against the registry. In sandbox this usually resolves in seconds.",
  },
  REVIEW: {
    title: "A person is reviewing",
    body: "The automatic check could not decide. The file has been passed to manual review — no action is needed from you yet.",
  },
  APPROVED: {
    title: "Verified",
    body: "The company is approved. Its business account is active and the dashboard is open.",
  },
  REJECTED: {
    title: "Needs attention",
    body: "The provider could not verify the company. Correct the details and start a new attempt when you are ready.",
  },
};

function TimelineRow({
  label,
  value,
  done,
  last,
}: {
  label: string;
  value: string;
  done: boolean;
  last?: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[14px_1fr] gap-4 pb-6 last:pb-0">
      <span className="relative flex justify-center">
        <span
          aria-hidden="true"
          className={
            done
              ? "mt-1 size-2 rounded-full bg-teal"
              : "mt-1 size-2 rounded-full border border-ink/25 bg-paper"
          }
        />
        {!last ? (
          <span
            aria-hidden="true"
            className="absolute bottom-0 top-3 w-px bg-rule"
          />
        ) : null}
      </span>
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted/70">
          {label}
        </p>
        <p className="mt-1 text-[13.5px] text-ink">{value}</p>
      </div>
    </li>
  );
}

export function VerificationStatus({ current }: { current: CurrentBusiness }) {
  const router = useRouter();
  const [verification, setVerification] = useState<VerificationSummary | null>(
    current.onboarding.verification,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = verification?.status ?? null;
  const terminal = status === "APPROVED" || status === "REJECTED";

  async function refresh(quiet = false) {
    if (!quiet) {
      setRefreshing(true);
      setError(null);
    }

    try {
      const latest = await verificationApi.latest();
      setVerification(latest);
    } catch (caught) {
      if (!quiet) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not refresh the decision.",
        );
      }
    } finally {
      if (!quiet) {
        setRefreshing(false);
      }
    }
  }

  /*
   * Polling is the recovery path for a missed webhook, not a substitute for
   * one. It stops as soon as the answer is terminal, and it never surfaces a
   * background failure as an error.
   */
  useEffect(() => {
    if (!status || terminal) {
      return;
    }

    const timer = window.setInterval(() => void refresh(true), 8000);

    return () => window.clearInterval(timer);
  }, [status, terminal]);

  if (!verification) {
    return (
      <div className="max-w-lg">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          No verification attempt has been opened for this business yet. The
          provider needs a session before it can return a decision.
        </p>
        <div className="mt-6 max-w-xs">
          <SubmitButton
            type="button"
            onClick={() => router.push("/onboarding/verify")}
          >
            Go to verification
          </SubmitButton>
        </div>
      </div>
    );
  }

  const copy = COPY[verification.status];

  return (
    <div>
      {error ? (
        <Alert tone="error" label="Refresh failed" className="mb-6">
          {error}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_19rem] lg:gap-14">
        <div>
          <div className="animate-rise">
            <StatusPill
              label={verificationLabel(verification.status)}
              tone={verificationTone(verification.status)}
            />
            <h2 className="mt-4 font-heading text-[clamp(2.2rem,4.4vw,3.2rem)] leading-[1.02] font-light tracking-[-0.015em] text-ink">
              {copy.title}
            </h2>
            <p className="mt-3 max-w-lg text-[13.5px] leading-relaxed text-ink-muted">
              {copy.body}
            </p>
          </div>

          {verification.status === "REJECTED" ? (
            <div className="mt-6 border-l-2 border-vermilion/50 py-1 pl-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-vermilion">
                Reason
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">
                {verification.rejectionReason ??
                  "The provider did not supply a reason."}
              </p>
              {verification.rejectionLabels.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {verification.rejectionLabels.map((label) => (
                    <li
                      key={label}
                      className="border border-vermilion/25 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-vermilion"
                    >
                      {scenarioLabel(label)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="mt-9">
            <p className="eyebrow mb-5">Record</p>
            <ol>
              <TimelineRow
                label="Attempt opened"
                value={`Attempt ${verification.attemptNumber}`}
                done
              />
              <TimelineRow
                label="Submitted to provider"
                value={
                  formatTimestamp(verification.submittedAt) ??
                  "Not submitted yet"
                }
                done={Boolean(verification.submittedAt)}
              />
              <TimelineRow
                label="Decision"
                value={
                  verification.status === "APPROVED" ||
                  verification.status === "REJECTED"
                    ? `${verificationLabel(verification.status)} · ${formatTimestamp(verification.reviewedAt) ?? "just now"}`
                    : verification.providerStatus ?? "Pending"
                }
                done={terminal}
                last
              />
            </ol>
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:max-w-xs">
            {verification.status === "APPROVED" ? (
              <SubmitButton type="button" onClick={() => router.push("/dashboard")}>
                Enter dashboard
              </SubmitButton>
            ) : null}

            {verification.status === "REJECTED" ? (
              <>
                <SubmitButton
                  type="button"
                  onClick={() => router.push("/onboarding/business")}
                >
                  Fix the details &amp; retry
                </SubmitButton>
                <SubmitButton
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/onboarding/verify")}
                >
                  Retry without changes
                </SubmitButton>
              </>
            ) : null}

            {!terminal ? (
              <SubmitButton
                type="button"
                variant="outline"
                loading={refreshing}
                onClick={() => void refresh()}
              >
                Check again
              </SubmitButton>
            ) : null}

            {verification.status === "NOT_STARTED" ||
            verification.actionRequired ? (
              <SubmitButton
                type="button"
                variant="quiet"
                onClick={() => router.push("/onboarding/verify")}
              >
                Reopen the hosted check
              </SubmitButton>
            ) : null}
          </div>
        </div>

        <aside className="paper-emboss self-start border border-rule p-5">
          <p className="eyebrow">Verification record</p>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-3 font-mono text-[10px] uppercase tracking-[0.12em]">
            <dt className="text-ink-muted/60">Provider</dt>
            <dd className="text-ink">{verification.provider}</dd>
            <dt className="text-ink-muted/60">Environment</dt>
            <dd className="text-ink">{verification.environment}</dd>
            <dt className="text-ink-muted/60">Attempt</dt>
            <dd className="tabular-nums text-ink">
              {verification.attemptNumber}
            </dd>
            <dt className="text-ink-muted/60">Provider status</dt>
            <dd className="text-right text-ink">
              {verification.providerStatus ?? "—"}
            </dd>
            {verification.sandboxScenario ? (
              <>
                <dt className="text-ink-muted/60">Scenario</dt>
                <dd className="text-ink">
                  {scenarioLabel(verification.sandboxScenario)}
                </dd>
              </>
            ) : null}
          </dl>

          {verification.environment === "SANDBOX" ? (
            <>
              <div className="my-4 h-px bg-rule" />
              <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-[#7a5a17]">
                Sandbox decision · not a real registry check
              </p>
            </>
          ) : null}

          {verification.provider === "SIMULATOR" && !terminal ? (
            <button
              type="button"
              onClick={() => router.push("/onboarding/simulate")}
              className="mt-4 w-full border border-dashed border-rule px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-teal transition-colors hover:border-teal"
            >
              Open sandbox controls
            </button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
