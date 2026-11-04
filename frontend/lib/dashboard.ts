/**
 * Dashboard vocabulary: what each role can see, and how the shell labels
 * things.
 *
 * This file is deliberately free of React and API calls. The role comes from
 * `GET /businesses/current`, which re-reads the membership on every request,
 * so nothing here can be stale for longer than one render.
 */

import type { BusinessStatus, UserRole } from "./auth";

/** The pencil-and-ink icons the sidebar uses. Kept as a union so a typo is a
 * compile error rather than a blank space. */
export type NavIconName =
  | "overview"
  | "team"
  | "account"
  | "transactions"
  | "card"
  | "payments"
  | "approvals"
  | "activity";

export interface NavItem {
  key: string;
  label: string;
  icon: NavIconName;
  /** Present only when the destination exists today. */
  href?: string;
  /** Short module tag shown on a deferred item, e.g. "M3". */
  module?: string;
  /** One line used as the item's title/tooltip. */
  hint: string;
  /** Small count shown beside the label (the approval queue). */
  badge?: number;
}

/**
 * The owner/admin rail.
 *
 * Team, Payments and Approvals are live in Module 5. Account and Transactions
 * stay operator-only because employees never see the business balance.
 */
const OPERATOR_NAV: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    icon: "overview",
    href: "/dashboard",
    hint: "Your organisation at a glance",
  },
  {
    key: "team",
    label: "Team",
    icon: "team",
    href: "/dashboard/team",
    hint: "Members, invitations and the approval policy",
  },
  {
    key: "account",
    label: "Account",
    icon: "account",
    href: "/dashboard/account",
    hint: "Wallet and available balance",
  },
  {
    key: "transactions",
    label: "Transactions",
    icon: "transactions",
    href: "/dashboard/transactions",
    hint: "Ledger movement and receipts",
  },
  {
    key: "cards",
    label: "Cards",
    icon: "card",
    href: "/dashboard/cards",
    hint: "Issue and control employee cards",
  },
  {
    key: "payments",
    label: "Payments",
    icon: "payments",
    href: "/dashboard/payments",
    hint: "Request an outbound payment",
  },
  {
    key: "approvals",
    label: "Approvals",
    icon: "approvals",
    href: "/dashboard/approvals",
    hint: "Payment requests waiting for a second person",
  },
];

/**
 * Employees have no team or business-level navigation. They see their own
 * card and their own payment requests only.
 */
const EMPLOYEE_NAV: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    icon: "overview",
    href: "/dashboard",
    hint: "Your account and your card",
  },
  {
    key: "card",
    label: "My card",
    icon: "card",
    href: "/dashboard/card",
    hint: "Your assigned virtual card",
  },
  {
    key: "payments",
    label: "Payments",
    icon: "payments",
    href: "/dashboard/payments",
    hint: "Your payment requests",
  },
];

/** Customer-facing operators. OPERATIONS is platform staff, not a customer. */
export function isOperator(role: UserRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canSeeTeam(role: UserRole): boolean {
  return isOperator(role);
}

export function navForRole(role: UserRole, pendingApprovals = 0): NavItem[] {
  if (canSeeTeam(role)) {
    if (pendingApprovals <= 0) {
      return OPERATOR_NAV;
    }

    return OPERATOR_NAV.map((item) =>
      item.key === "approvals" ? { ...item, badge: pendingApprovals } : item,
    );
  }

  if (role === "EMPLOYEE") {
    return EMPLOYEE_NAV;
  }

  return [];
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "EMPLOYEE":
      return "Employee";
    case "OPERATIONS":
      return "Operations";
  }
}

export type StatusTone =
  "neutral" | "progress" | "positive" | "negative" | "attention";

export function roleTone(role: UserRole): StatusTone {
  switch (role) {
    case "OWNER":
      return "positive";
    case "ADMIN":
      return "progress";
    case "EMPLOYEE":
      return "neutral";
    case "OPERATIONS":
      return "attention";
  }
}

export function businessStatus(status: BusinessStatus): {
  label: string;
  tone: StatusTone;
} {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "positive" };
    case "PENDING_VERIFICATION":
      return { label: "Pending verification", tone: "progress" };
    case "REJECTED":
      return { label: "Rejected", tone: "negative" };
    case "SUSPENDED":
      return { label: "Suspended", tone: "attention" };
    case "CLOSED":
      return { label: "Closed", tone: "neutral" };
  }
}

/** Two initials at most, so the avatar stays a seal rather than a paragraph. */
export function initialsFor(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");

  return cleaned.length > 0 ? cleaned.slice(0, 2).toUpperCase() : "NB";
}

/** Stable, timezone-independent date copy for the profile panel. */
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Which sidebar entry is current. */
export function sectionForPath(pathname: string): string {
  if (pathname.startsWith("/dashboard/account")) {
    return "Account";
  }

  if (pathname.startsWith("/dashboard/transactions")) {
    return "Transactions";
  }

  if (pathname.startsWith("/dashboard/team")) {
    return "Team";
  }

  if (pathname.startsWith("/dashboard/payments")) {
    return "Payments";
  }

  if (pathname.startsWith("/dashboard/approvals")) {
    return "Approvals";
  }

  if (pathname.startsWith("/dashboard/cards")) {
    return "Cards";
  }

  if (
    pathname === "/dashboard/card" ||
    pathname.startsWith("/dashboard/card/")
  ) {
    return "My card";
  }

  return "Overview";
}

/** ISO-4217 display for the one currency the MVP opens. */
export function currencyLabel(currency: string): string {
  return currency === "USD" ? "US dollars" : currency;
}
