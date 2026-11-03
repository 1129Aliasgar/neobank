"use client";

import { OnboardingGate } from "@/components/app/onboarding-gate";
import {
  OnboardingHeading,
  OnboardingShell,
} from "@/components/app/onboarding-shell";
import { VerificationStatus } from "@/components/onboarding/verification-status";
import { StatusPill } from "@/components/ui/alert";
import { verificationLabel, verificationTone } from "@/lib/status";

export default function VerificationStatusPage() {
  return (
    <OnboardingShell step={3}>
      <OnboardingGate
        allow={[
          "OPEN_VERIFICATION",
          "RETURN_TO_PROVIDER",
          "WAIT_FOR_REVIEW",
          "FIX_AND_RETRY",
          "DONE",
          "CONTACT_SUPPORT",
        ]}
      >
        {(current) => {
          if (current.onboarding.nextStep === "CONTACT_SUPPORT") {
            return (
              <>
                <OnboardingHeading
                  eyebrow="Account on hold"
                  title={
                    <>
                      This file needs
                      <br />
                      <span className="italic text-ink/60">a person.</span>
                    </>
                  }
                  lede="The business is suspended or closed, so the onboarding flow cannot continue from here."
                />
                <div className="max-w-lg border-l-2 border-vermilion/50 py-1 pl-4">
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-vermilion">
                    Status
                  </p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink">
                    Contact support at{" "}
                    <a
                      href="mailto:support@neobank.dev"
                      className="underline decoration-teal/40 underline-offset-4 hover:text-teal"
                    >
                      support@neobank.dev
                    </a>{" "}
                    and quote your business name.
                  </p>
                </div>
              </>
            );
          }

          const verification = current.onboarding.verification;

          return (
            <>
              <OnboardingHeading
                eyebrow="Step 03 · Decision"
                title={
                  <>
                    The decision,
                    <br />
                    <span className="italic text-ink/60">on the record.</span>
                  </>
                }
                lede="The provider writes the outcome; NeoBank applies it once. This page also polls as a fallback in case a webhook is delayed."
                aside={
                  verification ? (
                    <StatusPill
                      label={verificationLabel(verification.status)}
                      tone={verificationTone(verification.status)}
                    />
                  ) : null
                }
              />
              <VerificationStatus current={current} />
            </>
          );
        }}
      </OnboardingGate>
    </OnboardingShell>
  );
}
