"use client";

import { OnboardingGate } from "@/components/app/onboarding-gate";
import {
  OnboardingHeading,
  OnboardingShell,
} from "@/components/app/onboarding-shell";
import { SimulatorControls } from "@/components/onboarding/simulator-controls";

export default function SimulatorPage() {
  return (
    <OnboardingShell step={2}>
      {/* Sandbox utility: reachable in any onboarding state, gated only by auth. */}
      <OnboardingGate
        allow={[
          "COMPLETE_PROFILE",
          "START_VERIFICATION",
          "OPEN_VERIFICATION",
          "RETURN_TO_PROVIDER",
          "WAIT_FOR_REVIEW",
          "FIX_AND_RETRY",
          "DONE",
          "CONTACT_SUPPORT",
        ]}
      >
        {(current) => (
          <>
            <OnboardingHeading
              eyebrow="Sandbox tool"
              title={
                <>
                  Choose the
                  <br />
                  <span className="italic text-ink/60">provider&apos;s answer.</span>
                </>
              }
              lede="A local console for finishing the flow without Didit credentials. Every outcome runs through the same transition function a webhook would."
            />
            <SimulatorControls current={current} />
          </>
        )}
      </OnboardingGate>
    </OnboardingShell>
  );
}
