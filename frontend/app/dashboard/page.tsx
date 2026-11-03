"use client";

import { OnboardingGate } from "@/components/app/onboarding-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { EmployeeHome } from "@/components/dashboard/employee-home";
import { OwnerHome } from "@/components/dashboard/owner-home";
import { Refusal } from "@/components/dashboard/refusal";

export default function DashboardPage() {
  return (
    <OnboardingGate allow={["DONE"]}>
      {(current) => {
        if (current.role === "OPERATIONS") {
          return <Refusal role={current.role} />;
        }

        return (
          <DashboardShell current={current}>
            {current.role === "EMPLOYEE" ? (
              <EmployeeHome current={current} />
            ) : (
              <OwnerHome current={current} />
            )}
          </DashboardShell>
        );
      }}
    </OnboardingGate>
  );
}
