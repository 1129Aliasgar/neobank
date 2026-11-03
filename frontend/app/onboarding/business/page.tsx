"use client";

import { OnboardingGate } from "@/components/app/onboarding-gate";
import {
  OnboardingHeading,
  OnboardingShell,
} from "@/components/app/onboarding-shell";
import { BusinessForm } from "@/components/onboarding/business-form";
import { Alert, StatusPill } from "@/components/ui/alert";
import { businessLabel, businessTone } from "@/lib/status";

export default function BusinessProfilePage() {
  return (
    <OnboardingShell step={1}>
      {/* FIX_AND_RETRY is allowed here: after a decline the first useful
          action is often correcting the registered details. */}
      <OnboardingGate allow={["COMPLETE_PROFILE", "FIX_AND_RETRY"]}>
        {(current) => (
          <>
            <OnboardingHeading
              eyebrow="Step 01 · The entity"
              title={
                <>
                  Tell us about
                  <br />
                  <span className="italic text-ink/60">the company.</span>
                </>
              }
              lede="The legal name and registered address are what the verification provider checks against the registry. Everything else helps a reviewer understand the business."
              aside={
                <StatusPill
                  label={businessLabel(current.business.status)}
                  tone={businessTone(current.business.status)}
                />
              }
            />

            {current.onboarding.verification?.status === "REJECTED" ? (
              <Alert tone="warn" label="Previous attempt declined" className="mb-8">
                Correct anything the provider could not match — usually the
                legal name, entity type or registered address — then save to
                start a fresh attempt. Attempt{" "}
                {current.onboarding.verification.attemptNumber} is closed.
              </Alert>
            ) : null}

            <BusinessForm current={current} />
          </>
        )}
      </OnboardingGate>
    </OnboardingShell>
  );
}
