"use client";

import { OnboardingGate } from "@/components/app/onboarding-gate";
import {
  OnboardingHeading,
  OnboardingShell,
} from "@/components/app/onboarding-shell";
import { VerificationStart } from "@/components/onboarding/verification-start";

export default function VerificationPage() {
  return (
    <OnboardingShell step={2}>
      <OnboardingGate
        allow={[
          "START_VERIFICATION",
          "OPEN_VERIFICATION",
          "RETURN_TO_PROVIDER",
          "FIX_AND_RETRY",
        ]}
      >
        {(current) => (
          <>
            <OnboardingHeading
              eyebrow="Step 02 · Verification"
              title={
                <>
                  Prove the
                  <br />
                  <span className="italic text-ink/60">company exists.</span>
                </>
              }
              lede="A short hosted check with Didit. Your company details are pre-filled, and the decision comes back to NeoBank without you copying anything."
            />
            <VerificationStart current={current} />
          </>
        )}
      </OnboardingGate>
    </OnboardingShell>
  );
}
