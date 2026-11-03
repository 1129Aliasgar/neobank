import { StatusPill } from "@/components/ui/alert";
import { roleLabel, roleTone } from "@/lib/dashboard";
import type { UserRole } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** One badge for every role, so a role never drifts between two screens. */
export function RoleBadge({
  role,
  className,
}: {
  role: UserRole;
  className?: string;
}) {
  return (
    <StatusPill
      label={roleLabel(role)}
      tone={roleTone(role)}
      className={cn("shrink-0", className)}
    />
  );
}
